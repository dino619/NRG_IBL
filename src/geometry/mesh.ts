import type { MeshData } from "../types";

export function normalizeMesh(mesh: MeshData): void {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (let i = 0; i < mesh.vertexCount; i += 1) {
    for (let a = 0; a < 3; a += 1) {
      const v = mesh.positions[i * 3 + a];
      min[a] = Math.min(min[a], v);
      max[a] = Math.max(max[a], v);
    }
  }

  const center = [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5];
  const scale = 2 / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

  for (let i = 0; i < mesh.vertexCount; i += 1) {
    mesh.positions[i * 3 + 0] = (mesh.positions[i * 3 + 0] - center[0]) * scale;
    mesh.positions[i * 3 + 1] = (mesh.positions[i * 3 + 1] - center[1]) * scale;
    mesh.positions[i * 3 + 2] = (mesh.positions[i * 3 + 2] - center[2]) * scale;
  }
}

export function computeSmoothNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }

  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], y = normals[i + 1], z = normals[i + 2];
    const invLen = 1 / Math.max(Math.hypot(x, y, z), 1e-6);
    normals[i] = x * invLen;
    normals[i + 1] = y * invLen;
    normals[i + 2] = z * invLen;
  }
  return normals;
}
