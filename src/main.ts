import "./style.css";
import { initWebGPU } from "./webgpu/context";
import { Renderer } from "./renderer/renderer";
import { OrbitCamera } from "./renderer/camera";
import { UiController } from "./ui/ui";
import { FpsCounter } from "./utils/fps";
import { IblProcessor, type EnvironmentResources } from "./ibl/processor";
import { createSphere } from "./geometry/sphere";
import { GpuMesh } from "./renderer/gpuMesh";
import { loadAsciiPly } from "./loaders/ply";
import type { EnvironmentName, ModelName } from "./types";

declare global {
  interface Window {
    __IBL_CAPTURE_READY?: boolean;
    __IBL_CAPTURE_STATUS?: string;
  }
}

const MODEL_URLS: Partial<Record<ModelName, string>> = {
  bunny: "/assets/models/bunny.ply",
  dragon: "/assets/models/dragon.ply",
};

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu-canvas")!;
  const ui = new UiController();
  const fps = new FpsCounter();

  try {
    const webgpu = await initWebGPU(canvas);
    console.info("[WebGPU] Adapter", webgpu.adapter);
    console.info("[WebGPU] Device", webgpu.device);

    const renderer = new Renderer(webgpu.device, webgpu.context, webgpu.format);
    const camera = new OrbitCamera(canvas);
    applyCameraPreset(camera);
    const ibl = new IblProcessor(webgpu.device, (text) => ui.setStatus(text));
    const environments = new Map<EnvironmentName, Promise<EnvironmentResources>>();
    const resolvedEnvironments = new Map<EnvironmentName, EnvironmentResources>();
    const models = new Map<ModelName, Promise<GpuMesh>>();
    const resolvedModels = new Map<ModelName, GpuMesh>();

    const sphere = new GpuMesh(webgpu.device, createSphere(), "sphere");
    resolvedModels.set("sphere", sphere);
    models.set("sphere", Promise.resolve(sphere));

    const ensureEnvironment = (name: EnvironmentName): Promise<EnvironmentResources> => {
      const existing = environments.get(name);
      if (existing) return existing;
      const promise = ibl
        .loadEnvironment(name)
        .then((env) => {
          resolvedEnvironments.set(name, env);
          return env;
        })
        .catch((error) => {
          environments.delete(name);
          ui.setStatus(`Could not load ${name}. Check that public assets are present. ${String(error)}`);
          throw error;
        });
      environments.set(name, promise);
      return promise;
    };

    const ensureModel = (name: ModelName): Promise<GpuMesh> => {
      const existing = models.get(name);
      if (existing) return existing;
      const url = MODEL_URLS[name];
      if (!url) return Promise.resolve(sphere);
      ui.setStatus(`Loading ${name} mesh...`);
      const promise = loadAsciiPly(url)
        .then((mesh) => {
          const gpuMesh = new GpuMesh(webgpu.device, mesh, name);
          resolvedModels.set(name, gpuMesh);
          console.info(`[Model] ${name}: ${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles`);
          ui.setStatus(`Loaded ${name}: ${mesh.triangleCount.toLocaleString()} triangles.`);
          return gpuMesh;
        })
        .catch((error) => {
          models.delete(name);
          ui.setStatus(`Could not load ${name}. Check that public assets are present. ${String(error)}`);
          throw error;
        });
      models.set(name, promise);
      return promise;
    };

    ui.onChange = () => {
      void ensureEnvironment(ui.state.environment);
      void ensureModel(ui.state.model);
      if (ui.state.viewMode === "compare-env") {
        const other = comparisonEnvironment(ui.state.environment);
        void ensureEnvironment(other);
      }
    };
    void ensureEnvironment(ui.state.environment);
    void ensureModel(ui.state.model);
    if (ui.state.viewMode === "compare-env") {
      void ensureEnvironment(comparisonEnvironment(ui.state.environment));
    }

    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.resize(width, height);
    };

    const frame = (now: number) => {
      resize();
      fps.tick(now);

      const env = resolvedEnvironments.get(ui.state.environment) ?? null;
      const compareName = comparisonEnvironment(ui.state.environment);
      const compareEnv = resolvedEnvironments.get(compareName) ?? null;
      const mesh = resolvedModels.get(ui.state.model) ?? (ui.state.model === "sphere" ? sphere : null);
      const needsCompare = ui.state.viewMode === "compare-env";
      window.__IBL_CAPTURE_READY = Boolean(env && mesh && (!needsCompare || compareEnv));
      window.__IBL_CAPTURE_STATUS = window.__IBL_CAPTURE_READY
        ? "ready"
        : `waiting env=${Boolean(env)} mesh=${Boolean(mesh)} compare=${!needsCompare || Boolean(compareEnv)}`;

      renderer.render(ui.state, camera, mesh, sphere, env, compareEnv);

      const statsMesh = mesh ?? sphere;
      ui.setStats({
        fps: fps.fps,
        averageFps: fps.averageFps,
        frameMs: fps.frameMs,
        modelName: ui.state.model,
        vertices: statsMesh.vertexCount,
        triangles: statsMesh.triangleCount,
        envName: ui.state.environment,
        timings: env?.timings,
        textures: env?.stats,
      });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } catch (error) {
    ui.setStatus(String(error));
    console.error(error);
  }
}

void main();

function comparisonEnvironment(environment: EnvironmentName): EnvironmentName {
  if (environment === "venice_sunset") return "studio_small_09";
  return "venice_sunset";
}

function applyCameraPreset(camera: OrbitCamera): void {
  const params = new URLSearchParams(location.search);
  const yaw = params.get("yaw");
  const pitch = params.get("pitch");
  const distance = params.get("distance");
  const targetX = params.get("targetX");
  const targetY = params.get("targetY");
  const targetZ = params.get("targetZ");
  if (yaw !== null) camera.yaw = Number(yaw);
  if (pitch !== null) camera.pitch = Number(pitch);
  if (distance !== null) camera.distance = Number(distance);
  if (targetX !== null) camera.target[0] = Number(targetX);
  if (targetY !== null) camera.target[1] = Number(targetY);
  if (targetZ !== null) camera.target[2] = Number(targetZ);
}
