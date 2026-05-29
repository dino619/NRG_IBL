export const pbrShader = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4<f32>,
  model: mat4x4<f32>,
  cameraExposure: vec4<f32>,
  albedoMetallic: vec4<f32>,
  roughnessAoFlags: vec4<f32>,
  directMaxMip: vec4<f32>,
};

struct VertexIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

struct VertexOut {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var irradianceMap: texture_cube<f32>;
@group(0) @binding(2) var prefilterMap: texture_cube<f32>;
@group(0) @binding(3) var brdfLut: texture_2d<f32>;
@group(0) @binding(4) var iblSampler: sampler;

const PI: f32 = 3.14159265359;

@vertex
fn vsMain(in: VertexIn) -> VertexOut {
  let world = uniforms.model * vec4<f32>(in.position, 1.0);
  var out: VertexOut;
  out.clipPosition = uniforms.viewProj * world;
  out.worldPosition = world.xyz;
  out.normal = normalize((uniforms.model * vec4<f32>(in.normal, 0.0)).xyz);
  return out;
}

fn fresnelSchlick(cosTheta: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn rotateY(v: vec3<f32>, yaw: f32) -> vec3<f32> {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3<f32>(c * v.x - s * v.z, v.y, s * v.x + c * v.z);
}

fn distributionGGX(n: vec3<f32>, h: vec3<f32>, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let nDotH = max(dot(n, h), 0.0);
  let denom = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * denom * denom, 0.0001);
}

fn geometrySchlickGGX(nDotV: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return nDotV / max(nDotV * (1.0 - k) + k, 0.0001);
}

fn geometrySmith(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, roughness: f32) -> f32 {
  return geometrySchlickGGX(max(dot(n, v), 0.0), roughness) * geometrySchlickGGX(max(dot(n, l), 0.0), roughness);
}

fn tonemap(color: vec3<f32>, exposure: f32) -> vec3<f32> {
  let mapped = vec3<f32>(1.0) - exp(-color * exposure);
  return pow(mapped, vec3<f32>(1.0 / 2.2));
}

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let albedo = uniforms.albedoMetallic.rgb;
  let metallic = uniforms.albedoMetallic.a;
  let roughness = clamp(uniforms.roughnessAoFlags.x, 0.02, 1.0);
  let ao = uniforms.roughnessAoFlags.y;
  let useDiffuse = uniforms.roughnessAoFlags.z > 0.5;
  let useSpecular = uniforms.roughnessAoFlags.w > 0.5;
  let useDirect = uniforms.directMaxMip.x > 0.5;
  let exposure = uniforms.directMaxMip.y;
  let maxPrefilterMip = uniforms.directMaxMip.z;
  let envYaw = uniforms.directMaxMip.w;

  let n = normalize(in.normal);
  let v = normalize(uniforms.cameraExposure.xyz - in.worldPosition);
  let r = reflect(-v, n);
  let nDotV = max(dot(n, v), 0.001);
  var f0 = mix(vec3<f32>(0.04), albedo, metallic);

  var diffuse = vec3<f32>(0.0);
  if (useDiffuse) {
    let irradiance = textureSampleLevel(irradianceMap, iblSampler, rotateY(n, envYaw), 0.0).rgb;
    diffuse = irradiance * albedo * (1.0 - metallic);
  }

  var specular = vec3<f32>(0.0);
  if (useSpecular) {
    let prefiltered = textureSampleLevel(prefilterMap, iblSampler, rotateY(r, envYaw), roughness * maxPrefilterMip).rgb;
    let brdf = textureSampleLevel(brdfLut, iblSampler, vec2<f32>(nDotV, roughness), 0.0).rg;
    let f = fresnelSchlick(nDotV, f0);
    specular = prefiltered * (f * brdf.x + brdf.y);
  }

  var color = (diffuse + specular) * ao;

  if (useDirect) {
    let lightDir = normalize(vec3<f32>(-0.45, 0.85, 0.25));
    let radiance = vec3<f32>(2.0, 1.92, 1.75);
    let h = normalize(v + lightDir);
    let ndf = distributionGGX(n, h, roughness);
    let g = geometrySmith(n, v, lightDir, roughness);
    let f = fresnelSchlick(max(dot(h, v), 0.0), f0);
    let numerator = ndf * g * f;
    let denominator = 4.0 * max(dot(n, v), 0.0) * max(dot(n, lightDir), 0.0) + 0.0001;
    let kd = (vec3<f32>(1.0) - f) * (1.0 - metallic);
    color += (kd * albedo / PI + numerator / denominator) * radiance * max(dot(n, lightDir), 0.0);
  }

  return vec4<f32>(tonemap(color, exposure), 1.0);
}
`;

export const skyboxShader = /* wgsl */ `
struct Uniforms {
  invViewProj: mat4x4<f32>,
  cameraExposure: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var envMap: texture_cube<f32>;
@group(0) @binding(2) var envSampler: sampler;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  let p = positions[vertexIndex];
  var out: VertexOut;
  out.position = vec4<f32>(p, 1.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

fn tonemap(color: vec3<f32>, exposure: f32) -> vec3<f32> {
  return pow(vec3<f32>(1.0) - exp(-color * exposure), vec3<f32>(1.0 / 2.2));
}

fn rotateY(v: vec3<f32>, yaw: f32) -> vec3<f32> {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3<f32>(c * v.x - s * v.z, v.y, s * v.x + c * v.z);
}

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let ndc = vec4<f32>(in.uv * 2.0 - vec2<f32>(1.0), 1.0, 1.0);
  let world = uniforms.invViewProj * ndc;
  let dir = normalize(world.xyz / world.w);
  let color = textureSampleLevel(envMap, envSampler, rotateY(dir, uniforms.cameraExposure.x), 0.0).rgb;
  return vec4<f32>(tonemap(color, uniforms.cameraExposure.w), 1.0);
}
`;
