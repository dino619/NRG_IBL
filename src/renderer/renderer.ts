import { mat4 } from "wgpu-matrix";
import type { AppState } from "../types";
import { createDepthTexture } from "../webgpu/texture";
import type { EnvironmentResources } from "../ibl/processor";
import { pbrShader, skyboxShader } from "../shaders/renderShaders";
import type { OrbitCamera } from "./camera";
import type { GpuMesh } from "./gpuMesh";

interface RenderSize {
  width: number;
  height: number;
}

export class Renderer {
  private depthTexture: GPUTexture | null = null;
  private size: RenderSize = { width: 1, height: 1 };
  private sampler: GPUSampler;
  private pbrPipeline: GPURenderPipeline;
  private skyboxPipeline: GPURenderPipeline;
  private pbrUniform: GPUBuffer;
  private skyboxUniform: GPUBuffer;
  private roughnessStripUniforms: GPUBuffer[];

  constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private format: GPUTextureFormat,
  ) {
    this.pbrUniform = this.createUniformBuffer("PBR uniform", 192);
    this.skyboxUniform = this.createUniformBuffer("Skybox uniform", 80);
    this.roughnessStripUniforms = Array.from({ length: 5 }, (_, i) =>
      this.createUniformBuffer(`Roughness sphere ${i}`, 192),
    );

    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
    });

    const pbrModule = device.createShaderModule({ label: "PBR shader", code: pbrShader });
    this.pbrPipeline = device.createRenderPipeline({
      label: "PBR pipeline",
      layout: "auto",
      vertex: {
        module: pbrModule,
        entryPoint: "vsMain",
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: { module: pbrModule, entryPoint: "fsMain", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    const skyboxModule = device.createShaderModule({ label: "Skybox shader", code: skyboxShader });
    this.skyboxPipeline = device.createRenderPipeline({
      label: "Skybox pipeline",
      layout: "auto",
      vertex: { module: skyboxModule, entryPoint: "vsMain" },
      fragment: { module: skyboxModule, entryPoint: "fsMain", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" },
    });
  }

  resize(width: number, height: number): void {
    const clamped = { width: Math.max(1, width), height: Math.max(1, height) };
    if (clamped.width === this.size.width && clamped.height === this.size.height && this.depthTexture) return;
    this.size = clamped;
    this.depthTexture?.destroy();
    this.depthTexture = createDepthTexture(this.device, clamped.width, clamped.height);
  }

  render(
    state: AppState,
    camera: OrbitCamera,
    mesh: GpuMesh | null,
    sphereMesh: GpuMesh,
    env: EnvironmentResources | null,
    compareEnv: EnvironmentResources | null,
  ): void {
    const view = this.context.getCurrentTexture().createView();
    const encoder = this.device.createCommandEncoder({ label: "Main render encoder" });

    if (!env) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      return;
    }

    const aspect = this.size.width / this.size.height;

    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0.015, g: 0.016, b: 0.018, a: 1 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    if (state.viewMode === "compare-env" && compareEnv) {
      const left = { x: 0, y: 0, width: Math.floor(this.size.width / 2), height: this.size.height };
      const right = { x: left.width, y: 0, width: this.size.width - left.width, height: this.size.height };
      this.renderScene(pass, state, camera, mesh ?? sphereMesh, env, aspect, left);
      this.renderScene(pass, state, camera, mesh ?? sphereMesh, compareEnv, aspect, right);
    } else if (state.viewMode === "roughness-strip") {
      if (state.showSkybox) this.drawSkybox(pass, camera, env, aspect, state.envYaw);
      const roughnessValues = [0, 0.25, 0.5, 0.75, 1];
      for (let i = 0; i < roughnessValues.length; i += 1) {
        const model = mat4.translation([(i - 2) * 1.15, 0, 0]);
        mat4.scale(model, [0.48, 0.48, 0.48], model);
        const stripState = { ...state, roughness: Math.max(0.02, roughnessValues[i]) };
        this.writePbrUniform(this.roughnessStripUniforms[i], stripState, camera, aspect, model, env.maxPrefilterMip);
        this.drawMesh(pass, sphereMesh, env, this.roughnessStripUniforms[i]);
      }
    } else {
      this.renderScene(pass, state, camera, mesh ?? sphereMesh, env, aspect);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private renderScene(
    pass: GPURenderPassEncoder,
    state: AppState,
    camera: OrbitCamera,
    mesh: GpuMesh,
    env: EnvironmentResources,
    aspect: number,
    scissor?: { x: number; y: number; width: number; height: number },
  ): void {
    if (scissor) pass.setScissorRect(scissor.x, scissor.y, scissor.width, scissor.height);
    if (state.showSkybox) this.drawSkybox(pass, camera, env, aspect, state.envYaw);
    this.writePbrUniform(this.pbrUniform, state, camera, aspect, mat4.identity(), env.maxPrefilterMip);
    this.drawMesh(pass, mesh, env, this.pbrUniform);
    if (scissor) pass.setScissorRect(0, 0, this.size.width, this.size.height);
  }

  private drawSkybox(
    pass: GPURenderPassEncoder,
    camera: OrbitCamera,
    env: EnvironmentResources,
    aspect: number,
    envYaw: number,
  ): void {
    this.writeSkyboxUniform(camera.skyInvViewProjection(aspect), envYaw, 1.0);
    pass.setPipeline(this.skyboxPipeline);
    pass.setBindGroup(0, this.makeSkyboxBindGroup(env, this.skyboxUniform));
    pass.draw(3);
  }

  private drawMesh(pass: GPURenderPassEncoder, mesh: GpuMesh, env: EnvironmentResources, uniform: GPUBuffer): void {
    pass.setPipeline(this.pbrPipeline);
    pass.setBindGroup(0, this.makePbrBindGroup(env, uniform));
    pass.setVertexBuffer(0, mesh.vertexBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, "uint32");
    pass.drawIndexed(mesh.indexCount);
  }

  private writePbrUniform(
    buffer: GPUBuffer,
    state: AppState,
    camera: OrbitCamera,
    aspect: number,
    model: Float32Array,
    maxPrefilterMip: number,
  ): void {
    const data = new Float32Array(48);
    data.set(camera.viewProjection(aspect), 0);
    data.set(model, 16);
    data.set(camera.position(), 32);
    data[35] = 1;
    data.set(state.albedo, 36);
    data[39] = state.metallic;
    data[40] = state.roughness;
    data[41] = state.ao;
    data[42] = state.diffuseIBL ? 1 : 0;
    data[43] = state.specularIBL ? 1 : 0;
    data[44] = 0;
    data[45] = 1.0;
    data[46] = maxPrefilterMip;
    data[47] = state.envYaw;
    this.device.queue.writeBuffer(buffer, 0, data);
  }

  private writeSkyboxUniform(invViewProj: Float32Array, envYaw: number, exposure: number): void {
    const data = new Float32Array(20);
    data.set(invViewProj, 0);
    data[16] = envYaw;
    data[19] = exposure;
    this.device.queue.writeBuffer(this.skyboxUniform, 0, data);
  }

  private makePbrBindGroup(env: EnvironmentResources, uniform: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pbrPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: env.irradianceView },
        { binding: 2, resource: env.prefilterView },
        { binding: 3, resource: env.brdfLutView },
        { binding: 4, resource: this.sampler },
      ],
    });
  }

  private makeSkyboxBindGroup(env: EnvironmentResources, uniform: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.skyboxPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: env.envView },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  private createUniformBuffer(label: string, size: number): GPUBuffer {
    return this.device.createBuffer({
      label,
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }
}
