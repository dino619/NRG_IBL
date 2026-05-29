export const fullscreenVertex = /* wgsl */ `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  let p = positions[vertexIndex];
  var out: VertexOut;
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

fn faceDirection(face: u32, uv: vec2<f32>) -> vec3<f32> {
  let xy = uv * 2.0 - vec2<f32>(1.0);
  let x = xy.x;
  let y = xy.y;
  if (face == 0u) { return normalize(vec3<f32>( 1.0, y, -x)); }
  if (face == 1u) { return normalize(vec3<f32>(-1.0, y,  x)); }
  if (face == 2u) { return normalize(vec3<f32>( x,  1.0, -y)); }
  if (face == 3u) { return normalize(vec3<f32>( x, -1.0,  y)); }
  if (face == 4u) { return normalize(vec3<f32>( x, y,  1.0)); }
  return normalize(vec3<f32>(-x, y, -1.0));
}
`;

export const equirectToCubemapShader = /* wgsl */ `
${fullscreenVertex}

struct Params {
  face: u32,
  _pad0: vec3<u32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var hdrMap: texture_2d<f32>;
@group(0) @binding(2) var hdrSampler: sampler;

const PI: f32 = 3.14159265359;

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let dir = faceDirection(params.face, in.uv);
  let uv = vec2<f32>(atan2(dir.z, dir.x) / (2.0 * PI) + 0.5, acos(clamp(dir.y, -1.0, 1.0)) / PI);
  let color = textureSampleLevel(hdrMap, hdrSampler, uv, 0.0).rgb;
  return vec4<f32>(color, 1.0);
}
`;

export const irradianceShader = /* wgsl */ `
${fullscreenVertex}

struct Params {
  face: u32,
  _pad0: vec3<u32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var envMap: texture_cube<f32>;
@group(0) @binding(2) var envSampler: sampler;

const PI: f32 = 3.14159265359;

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let n = faceDirection(params.face, in.uv);
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(n.y) > 0.999) {
    up = vec3<f32>(0.0, 0.0, 1.0);
  }
  let right = normalize(cross(up, n));
  up = normalize(cross(n, right));

  var irradiance = vec3<f32>(0.0);
  var sampleCount = 0.0;
  let sampleDelta = 0.18;
  for (var phi = 0.0; phi < 2.0 * PI; phi = phi + sampleDelta) {
    for (var theta = 0.0; theta < 0.5 * PI; theta = theta + sampleDelta) {
      let tangentSample = vec3<f32>(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
      let sampleVec = tangentSample.x * right + tangentSample.y * up + tangentSample.z * n;
      irradiance += textureSampleLevel(envMap, envSampler, sampleVec, 0.0).rgb * cos(theta) * sin(theta);
      sampleCount += 1.0;
    }
  }
  irradiance = PI * irradiance / max(sampleCount, 1.0);
  return vec4<f32>(irradiance, 1.0);
}
`;

export const prefilterShader = /* wgsl */ `
${fullscreenVertex}

struct Params {
  face: u32,
  sampleCount: u32,
  roughness: f32,
  _pad0: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var envMap: texture_cube<f32>;
@group(0) @binding(2) var envSampler: sampler;

const PI: f32 = 3.14159265359;

fn radicalInverseVdc(bitsIn: u32) -> f32 {
  var bits = bitsIn;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, n: u32) -> vec2<f32> {
  return vec2<f32>(f32(i) / f32(n), radicalInverseVdc(i));
}

fn importanceSampleGGX(xi: vec2<f32>, n: vec3<f32>, roughness: f32) -> vec3<f32> {
  let a = roughness * roughness;
  let phi = 2.0 * PI * xi.x;
  let cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  let sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
  let h = vec3<f32>(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(n.y) > 0.999) {
    up = vec3<f32>(0.0, 0.0, 1.0);
  }
  let tangent = normalize(cross(up, n));
  let bitangent = cross(n, tangent);
  return normalize(tangent * h.x + bitangent * h.y + n * h.z);
}

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let n = faceDirection(params.face, in.uv);
  let r = n;
  let v = r;
  var prefiltered = vec3<f32>(0.0);
  var totalWeight = 0.0;

  for (var i = 0u; i < params.sampleCount; i = i + 1u) {
    let xi = hammersley(i, params.sampleCount);
    let h = importanceSampleGGX(xi, n, params.roughness);
    let l = normalize(2.0 * dot(v, h) * h - v);
    let nDotL = max(dot(n, l), 0.0);
    if (nDotL > 0.0) {
      prefiltered += textureSampleLevel(envMap, envSampler, l, 0.0).rgb * nDotL;
      totalWeight += nDotL;
    }
  }
  return vec4<f32>(prefiltered / max(totalWeight, 0.0001), 1.0);
}
`;

export const brdfLutShader = /* wgsl */ `
${fullscreenVertex}

const PI: f32 = 3.14159265359;

fn radicalInverseVdc(bitsIn: u32) -> f32 {
  var bits = bitsIn;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, n: u32) -> vec2<f32> {
  return vec2<f32>(f32(i) / f32(n), radicalInverseVdc(i));
}

fn importanceSampleGGX(xi: vec2<f32>, n: vec3<f32>, roughness: f32) -> vec3<f32> {
  let a = roughness * roughness;
  let phi = 2.0 * PI * xi.x;
  let cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  let sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
  let h = vec3<f32>(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
  let up = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(n.y) > 0.999);
  let tangent = normalize(cross(up, n));
  let bitangent = cross(n, tangent);
  return normalize(tangent * h.x + bitangent * h.y + n * h.z);
}

fn geometrySchlickGGX(nDotV: f32, roughness: f32) -> f32 {
  let a = roughness;
  let k = (a * a) / 2.0;
  return nDotV / (nDotV * (1.0 - k) + k);
}

fn geometrySmith(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, roughness: f32) -> f32 {
  return geometrySchlickGGX(max(dot(n, v), 0.0), roughness) * geometrySchlickGGX(max(dot(n, l), 0.0), roughness);
}

fn integrateBRDF(nDotV: f32, roughness: f32) -> vec2<f32> {
  let v = vec3<f32>(sqrt(max(1.0 - nDotV * nDotV, 0.0)), 0.0, nDotV);
  let n = vec3<f32>(0.0, 0.0, 1.0);
  var a = 0.0;
  var b = 0.0;
  let sampleCount = 1024u;
  for (var i = 0u; i < sampleCount; i = i + 1u) {
    let xi = hammersley(i, sampleCount);
    let h = importanceSampleGGX(xi, n, roughness);
    let l = normalize(2.0 * dot(v, h) * h - v);
    let nDotL = max(l.z, 0.0);
    let nDotH = max(h.z, 0.0);
    let vDotH = max(dot(v, h), 0.0);
    if (nDotL > 0.0) {
      let g = geometrySmith(n, v, l, roughness);
      let gVis = (g * vDotH) / max(nDotH * nDotV, 0.0001);
      let fc = pow(1.0 - vDotH, 5.0);
      a += (1.0 - fc) * gVis;
      b += fc * gVis;
    }
  }
  return vec2<f32>(a, b) / f32(sampleCount);
}

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let uv = clamp(in.uv, vec2<f32>(0.001), vec2<f32>(0.999));
  let brdf = integrateBRDF(uv.x, uv.y);
  return vec4<f32>(brdf, 0.0, 1.0);
}
`;
