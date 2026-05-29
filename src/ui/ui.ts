import type { AppState, EnvironmentName, ModelName, PreprocessTimings, TextureStats, ViewMode } from "../types";
import { hexToLinearRgb } from "../utils/color";

export class UiController {
  state: AppState = {
    environment: "venice_sunset",
    model: "sphere",
    viewMode: "final",
    albedo: hexToLinearRgb("#d7d1c5"),
    metallic: 0,
    roughness: 0.35,
    ao: 1,
    diffuseIBL: true,
    specularIBL: true,
    showSkybox: true,
    envYaw: 0,
  };

  onChange: (() => void) | null = null;
  private statusEl = document.querySelector<HTMLDivElement>("#preprocessStatus")!;
  private statsEl = document.querySelector<HTMLDivElement>("#stats")!;

  constructor() {
    const environment = document.querySelector<HTMLSelectElement>("#environment")!;
    const model = document.querySelector<HTMLSelectElement>("#model")!;
    const viewMode = document.querySelector<HTMLSelectElement>("#viewMode")!;
    const albedo = document.querySelector<HTMLInputElement>("#albedo")!;
    const metallic = document.querySelector<HTMLInputElement>("#metallic")!;
    const roughness = document.querySelector<HTMLInputElement>("#roughness")!;
    const ao = document.querySelector<HTMLInputElement>("#ao")!;
    const diffuseIBL = document.querySelector<HTMLInputElement>("#diffuseIBL")!;
    const specularIBL = document.querySelector<HTMLInputElement>("#specularIBL")!;
    const showSkybox = document.querySelector<HTMLInputElement>("#showSkybox")!;

    applyUrlPreset({
      environment,
      model,
      viewMode,
      albedo,
      metallic,
      roughness,
      ao,
      diffuseIBL,
      specularIBL,
      showSkybox,
    });

    const sync = () => {
      this.state.environment = environment.value as EnvironmentName;
      this.state.model = model.value as ModelName;
      this.state.viewMode = viewMode.value as ViewMode;
      this.state.albedo = hexToLinearRgb(albedo.value);
      this.state.metallic = Number(metallic.value);
      this.state.roughness = Number(roughness.value);
      this.state.ao = Number(ao.value);
      this.state.diffuseIBL = diffuseIBL.checked;
      this.state.specularIBL = specularIBL.checked;
      this.state.showSkybox = showSkybox.checked;
      this.state.envYaw = Number(new URLSearchParams(location.search).get("envYaw") ?? "0");
      document.querySelector("#metallicValue")!.textContent = this.state.metallic.toFixed(2);
      document.querySelector("#roughnessValue")!.textContent = this.state.roughness.toFixed(2);
      document.querySelector("#aoValue")!.textContent = this.state.ao.toFixed(2);
      this.onChange?.();
    };

    [
      environment,
      model,
      viewMode,
      albedo,
      metallic,
      roughness,
      ao,
      diffuseIBL,
      specularIBL,
      showSkybox,
    ].forEach((el) => el.addEventListener("input", sync));
    sync();
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  setStats(values: {
    fps: number;
    averageFps: number;
    frameMs: number;
    modelName: string;
    vertices: number;
    triangles: number;
    envName: string;
    timings?: PreprocessTimings;
    textures?: TextureStats;
  }): void {
    const timings = values.timings
      ? [
          `eq->cube   ${values.timings.equirectToCubemapMs.toFixed(1)} ms`,
          `irradiance ${values.timings.irradianceMs.toFixed(1)} ms`,
          `prefilter  ${values.timings.prefilterMs.toFixed(1)} ms`,
          `brdf lut   ${values.timings.brdfLutMs.toFixed(1)} ms`,
        ]
      : ["preprocess pending"];
    const textures = values.textures
      ? [
          `env    ${values.textures.envCubemap}`,
          `irr    ${values.textures.irradiance}`,
          `pref   ${values.textures.prefilter}`,
          `brdf   ${values.textures.brdfLut}`,
        ]
      : [];
    this.statsEl.textContent = [
      `FPS        ${values.fps.toFixed(1)}`,
      `avg FPS    ${values.averageFps.toFixed(1)}`,
      `frame      ${values.frameMs.toFixed(2)} ms`,
      `env        ${values.envName}`,
      `model      ${values.modelName}`,
      `vertices   ${values.vertices.toLocaleString()}`,
      `triangles  ${values.triangles.toLocaleString()}`,
      ...timings,
      ...textures,
    ].join("\n");
  }
}

function applyUrlPreset(elements: {
  environment: HTMLSelectElement;
  model: HTMLSelectElement;
  viewMode: HTMLSelectElement;
  albedo: HTMLInputElement;
  metallic: HTMLInputElement;
  roughness: HTMLInputElement;
  ao: HTMLInputElement;
  diffuseIBL: HTMLInputElement;
  specularIBL: HTMLInputElement;
  showSkybox: HTMLInputElement;
}): void {
  const params = new URLSearchParams(location.search);
  const setValue = (key: string, input: HTMLInputElement | HTMLSelectElement) => {
    const value = params.get(key);
    if (value !== null) input.value = value;
  };
  const setBool = (key: string, input: HTMLInputElement) => {
    const value = params.get(key);
    if (value !== null) input.checked = value === "1" || value === "true";
  };

  setValue("env", elements.environment);
  setValue("model", elements.model);
  setValue("mode", elements.viewMode);
  setValue("albedo", elements.albedo);
  setValue("metallic", elements.metallic);
  setValue("roughness", elements.roughness);
  setValue("ao", elements.ao);
  setBool("diffuse", elements.diffuseIBL);
  setBool("specular", elements.specularIBL);
  setBool("skybox", elements.showSkybox);

  if (params.get("clean") === "1" || params.get("clean") === "true") {
    document.body.classList.add("capture-clean");
  }
}
