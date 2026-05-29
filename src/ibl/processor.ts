import { loadHdr } from "../loaders/hdr";
import { writeRgba16FloatTexture } from "../webgpu/texture";
import type { EnvironmentName, PreprocessTimings, TextureStats } from "../types";
import {
  brdfLutShader,
  equirectToCubemapShader,
  irradianceShader,
  prefilterShader,
} from "../shaders/iblPreprocess";

export interface EnvironmentResources {
  name: EnvironmentName;
  envTexture: GPUTexture;
  envView: GPUTextureView;
  irradianceTexture: GPUTexture;
  irradianceView: GPUTextureView;
  prefilterTexture: GPUTexture;
  prefilterView: GPUTextureView;
  brdfLutTexture: GPUTexture;
  brdfLutView: GPUTextureView;
  maxPrefilterMip: number;
  timings: PreprocessTimings;
  stats: TextureStats;
}

const HDR_URLS: Record<EnvironmentName, string> = {
  venice_sunset: "/assets/hdr/venice_sunset_1k.hdr",
  studio_small_09: "/assets/hdr/studio_small_09_1k.hdr",
  kiara_1_dawn: "/assets/hdr/kiara_1_dawn_1k.hdr",
};

export class IblProcessor {
  private sampler: GPUSampler;
  private equirectPipeline: GPURenderPipeline;
  private irradiancePipeline: GPURenderPipeline;
  private prefilterPipeline: GPURenderPipeline;
  private brdfPipeline: GPURenderPipeline;

  constructor(private device: GPUDevice, private status: (text: string) => void) {
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
    });
    this.equirectPipeline = this.makePipeline("equirect-to-cubemap", equirectToCubemapShader, "rgba16float");
    this.irradiancePipeline = this.makePipeline("irradiance convolution", irradianceShader, "rgba16float");
    this.prefilterPipeline = this.makePipeline("specular prefilter", prefilterShader, "rgba16float");
    this.brdfPipeline = this.makePipeline("brdf integration lut", brdfLutShader, "rgba16float");
  }

  async loadEnvironment(name: EnvironmentName): Promise<EnvironmentResources> {
    this.status(`Loading HDR environment ${name}...`);
    const hdr = await loadHdr(HDR_URLS[name]);
    console.info(`[IBL] Loaded ${name}: ${hdr.width}x${hdr.height} HDR pixels`);

    const hdrTexture = this.device.createTexture({
      label: `${name} equirect HDR`,
      size: { width: hdr.width, height: hdr.height },
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    writeRgba16FloatTexture(this.device, hdrTexture, hdr.width, hdr.height, hdr.rgba16);
    const hdrView = hdrTexture.createView();

    const envSize = 512;
    const irradianceSize = 64;
    const prefilterSize = 256;
    const brdfSize = 256;
    const prefilterMipCount = Math.floor(Math.log2(prefilterSize)) + 1;

    const envTexture = this.createCubeTexture(`${name} environment cubemap`, envSize, 1);
    const irradianceTexture = this.createCubeTexture(`${name} irradiance cubemap`, irradianceSize, 1);
    const prefilterTexture = this.createCubeTexture(`${name} prefiltered cubemap`, prefilterSize, prefilterMipCount);
    const brdfLutTexture = this.device.createTexture({
      label: `${name} BRDF LUT`,
      size: { width: brdfSize, height: brdfSize },
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.status(`Preprocessing ${name}: equirectangular map to cubemap...`);
    const equirectToCubemapMs = await this.renderCubeFaces(
      this.equirectPipeline,
      envTexture,
      envSize,
      0,
      (pipeline, face) => this.createBindGroup(pipeline, face, hdrView),
      "equirectangular to cubemap",
    );

    this.status(`Preprocessing ${name}: diffuse irradiance convolution...`);
    const envView = envTexture.createView({ dimension: "cube" });
    const irradianceMs = await this.renderCubeFaces(
      this.irradiancePipeline,
      irradianceTexture,
      irradianceSize,
      0,
      (pipeline, face) => this.createBindGroup(pipeline, face, envView),
      "diffuse irradiance convolution",
    );

    this.status(`Preprocessing ${name}: split-sum BRDF LUT...`);
    const brdfLutMs = await this.renderBrdfLut(brdfLutTexture, brdfSize);

    this.status(`Preprocessing ${name}: GGX specular prefilter...`);
    const prefilterStart = performance.now();
    for (let mip = 0; mip < prefilterMipCount; mip += 1) {
      const mipSize = Math.max(1, prefilterSize >> mip);
      const roughness = mip / Math.max(prefilterMipCount - 1, 1);
      await this.renderCubeFaces(
        this.prefilterPipeline,
        prefilterTexture,
        mipSize,
        mip,
        (pipeline, face) => this.createBindGroup(pipeline, face, envView, roughness, 256),
        `specular prefilter mip ${mip}`,
      );
    }
    const prefilterMs = performance.now() - prefilterStart;

    const resources: EnvironmentResources = {
      name,
      envTexture,
      envView,
      irradianceTexture,
      irradianceView: irradianceTexture.createView({ dimension: "cube" }),
      prefilterTexture,
      prefilterView: prefilterTexture.createView({ dimension: "cube", mipLevelCount: prefilterMipCount }),
      brdfLutTexture,
      brdfLutView: brdfLutTexture.createView(),
      maxPrefilterMip: prefilterMipCount - 1,
      timings: { equirectToCubemapMs, irradianceMs, prefilterMs, brdfLutMs },
      stats: {
        envCubemap: `${envSize}x${envSize}x6 rgba16float`,
        irradiance: `${irradianceSize}x${irradianceSize}x6 rgba16float`,
        prefilter: `${prefilterSize}x${prefilterSize}x6, ${prefilterMipCount} mips rgba16float`,
        brdfLut: `${brdfSize}x${brdfSize} rgba16float`,
      },
    };

    console.info(`[IBL] ${name} preprocessing`, resources.timings, resources.stats);
    this.status(`Ready: ${name} preprocessed.`);
    return resources;
  }

  private makePipeline(label: string, code: string, format: GPUTextureFormat): GPURenderPipeline {
    return this.device.createRenderPipeline({
      label,
      layout: "auto",
      vertex: { module: this.device.createShaderModule({ label: `${label} shader`, code }), entryPoint: "vsMain" },
      fragment: {
        module: this.device.createShaderModule({ label: `${label} shader`, code }),
        entryPoint: "fsMain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private createCubeTexture(label: string, size: number, mipLevelCount: number): GPUTexture {
    return this.device.createTexture({
      label,
      size: { width: size, height: size, depthOrArrayLayers: 6 },
      mipLevelCount,
      dimension: "2d",
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private createBindGroup(
    pipeline: GPURenderPipeline,
    face: number,
    sourceView: GPUTextureView,
    roughness = 0,
    sampleCount = 0,
  ): GPUBindGroup {
    const uniform = this.device.createBuffer({
      label: "IBL pass params",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const data = new ArrayBuffer(32);
    new Uint32Array(data, 0, 2).set([face, sampleCount]);
    new Float32Array(data, 8, 1)[0] = roughness;
    this.device.queue.writeBuffer(uniform, 0, data);
    return this.device.createBindGroup({
      label: "IBL pass bind group",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: sourceView },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  private async renderCubeFaces(
    pipeline: GPURenderPipeline,
    texture: GPUTexture,
    size: number,
    mip: number,
    makeBindGroup: (pipeline: GPURenderPipeline, face: number) => GPUBindGroup,
    label: string,
  ): Promise<number> {
    const start = performance.now();
    const encoder = this.device.createCommandEncoder({ label });
    for (let face = 0; face < 6; face += 1) {
      const pass = encoder.beginRenderPass({
        label: `${label} face ${face}`,
        colorAttachments: [
          {
            view: texture.createView({
              dimension: "2d",
              baseArrayLayer: face,
              arrayLayerCount: 1,
              baseMipLevel: mip,
              mipLevelCount: 1,
            }),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, makeBindGroup(pipeline, face));
      pass.draw(3);
      pass.end();
    }
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    return performance.now() - start;
  }

  private async renderBrdfLut(texture: GPUTexture, size: number): Promise<number> {
    const start = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "BRDF LUT render" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.brdfPipeline);
    pass.setViewport(0, 0, size, size, 0, 1);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    return performance.now() - start;
  }
}
