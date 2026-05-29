export type ModelName = "sphere" | "bunny" | "dragon";
export type EnvironmentName = "venice_sunset" | "studio_small_09" | "kiara_1_dawn";
export type ViewMode = "final" | "compare-env" | "roughness-strip";

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface AppState {
  environment: EnvironmentName;
  model: ModelName;
  viewMode: ViewMode;
  albedo: [number, number, number];
  metallic: number;
  roughness: number;
  ao: number;
  diffuseIBL: boolean;
  specularIBL: boolean;
  showSkybox: boolean;
  envYaw: number;
}

export interface PreprocessTimings {
  equirectToCubemapMs: number;
  irradianceMs: number;
  prefilterMs: number;
  brdfLutMs: number;
}

export interface TextureStats {
  envCubemap: string;
  irradiance: string;
  prefilter: string;
  brdfLut: string;
}
