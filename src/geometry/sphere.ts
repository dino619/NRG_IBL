import type { MeshData } from "../types";

export function createSphere(segments = 96, rings = 48): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= rings; y += 1) {
    const v = y / rings;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let x = 0; x <= segments; x += 1) {
      const u = x / segments;
      const phi = u * Math.PI * 2;
      const nx = Math.cos(phi) * sinTheta;
      const ny = cosTheta;
      const nz = Math.sin(phi) * sinTheta;
      positions.push(nx, ny, nz);
      normals.push(nx, ny, nz);
    }
  }

  for (let y = 0; y < rings; y += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = y * (segments + 1) + x;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}
