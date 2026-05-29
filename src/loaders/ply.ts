import type { MeshData } from "../types";
import { normalizeMesh, computeSmoothNormals } from "../geometry/mesh";

export async function loadAsciiPly(url: string): Promise<MeshData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load model ${url}: ${response.status}`);
  return parseAsciiPly(await response.text());
}

export function parseAsciiPly(text: string): MeshData {
  const lines = text.split(/\r?\n/);
  let i = 0;
  let vertexCount = 0;
  let faceCount = 0;
  const vertexProperties: string[] = [];
  let inVertex = false;

  if (lines[i++].trim() !== "ply") throw new Error("Not a PLY file.");
  for (; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("element vertex")) {
      vertexCount = Number(line.split(/\s+/)[2]);
      inVertex = true;
    } else if (line.startsWith("element face")) {
      faceCount = Number(line.split(/\s+/)[2]);
      inVertex = false;
    } else if (line.startsWith("property") && inVertex) {
      const parts = line.split(/\s+/);
      vertexProperties.push(parts[parts.length - 1]);
    } else if (line === "end_header") {
      i += 1;
      break;
    }
  }

  const xIndex = vertexProperties.indexOf("x");
  const yIndex = vertexProperties.indexOf("y");
  const zIndex = vertexProperties.indexOf("z");
  const nxIndex = vertexProperties.indexOf("nx");
  const nyIndex = vertexProperties.indexOf("ny");
  const nzIndex = vertexProperties.indexOf("nz");

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  let hasNormals = nxIndex >= 0 && nyIndex >= 0 && nzIndex >= 0;

  for (let v = 0; v < vertexCount; v += 1, i += 1) {
    const parts = lines[i].trim().split(/\s+/).map(Number);
    positions[v * 3 + 0] = parts[xIndex];
    positions[v * 3 + 1] = parts[yIndex];
    positions[v * 3 + 2] = parts[zIndex];
    if (hasNormals) {
      normals[v * 3 + 0] = parts[nxIndex];
      normals[v * 3 + 1] = parts[nyIndex];
      normals[v * 3 + 2] = parts[nzIndex];
    }
  }

  const indices: number[] = [];
  for (let f = 0; f < faceCount; f += 1, i += 1) {
    const parts = lines[i].trim().split(/\s+/).map(Number);
    const count = parts[0];
    for (let k = 1; k < count - 1; k += 1) {
      indices.push(parts[1], parts[1 + k], parts[2 + k]);
    }
  }

  const mesh: MeshData = {
    positions,
    normals: hasNormals ? normals : computeSmoothNormals(positions, new Uint32Array(indices)),
    indices: new Uint32Array(indices),
    vertexCount,
    triangleCount: indices.length / 3,
  };
  normalizeMesh(mesh);
  if (!hasNormals) mesh.normals = computeSmoothNormals(mesh.positions, mesh.indices);
  return mesh;
}
