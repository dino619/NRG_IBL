import type { MeshData } from "../types";

export class GpuMesh {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  vertexCount: number;
  triangleCount: number;

  constructor(device: GPUDevice, mesh: MeshData, label: string) {
    const vertices = new Float32Array(mesh.vertexCount * 6);
    for (let i = 0; i < mesh.vertexCount; i += 1) {
      vertices[i * 6 + 0] = mesh.positions[i * 3 + 0];
      vertices[i * 6 + 1] = mesh.positions[i * 3 + 1];
      vertices[i * 6 + 2] = mesh.positions[i * 3 + 2];
      vertices[i * 6 + 3] = mesh.normals[i * 3 + 0];
      vertices[i * 6 + 4] = mesh.normals[i * 3 + 1];
      vertices[i * 6 + 5] = mesh.normals[i * 3 + 2];
    }

    this.vertexBuffer = device.createBuffer({
      label: `${label} vertices`,
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, vertices as GPUAllowSharedBufferSource);

    this.indexBuffer = device.createBuffer({
      label: `${label} indices`,
      size: mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.indexBuffer, 0, mesh.indices as GPUAllowSharedBufferSource);

    this.indexCount = mesh.indices.length;
    this.vertexCount = mesh.vertexCount;
    this.triangleCount = mesh.triangleCount;
  }
}
