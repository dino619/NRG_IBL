import { rgbFloatToRgba16Float } from "../utils/halfFloat";

export interface HdrImage {
  width: number;
  height: number;
  rgb: Float32Array;
  rgba16: Uint16Array;
}

export async function loadHdr(url: string): Promise<HdrImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load HDR file ${url}: ${response.status}`);
  return parseHdr(new Uint8Array(await response.arrayBuffer()));
}

export function parseHdr(bytes: Uint8Array): HdrImage {
  let offset = 0;
  const readLine = () => {
    let line = "";
    while (offset < bytes.length) {
      const c = bytes[offset++];
      if (c === 10) break;
      if (c !== 13) line += String.fromCharCode(c);
    }
    return line;
  };

  let format = "";
  let dimensions = "";
  for (;;) {
    const line = readLine();
    if (line.startsWith("FORMAT=")) format = line.slice("FORMAT=".length);
    if (line.length === 0) {
      dimensions = readLine();
      break;
    }
  }

  if (format !== "32-bit_rle_rgbe") {
    throw new Error(`Unsupported HDR format: ${format}`);
  }

  const match = dimensions.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!match) throw new Error(`Unsupported HDR dimensions: ${dimensions}`);
  const height = Number(match[1]);
  const width = Number(match[2]);
  const rgbe = decodeRgbe(bytes, offset, width, height);
  const rgb = new Float32Array(width * height * 3);

  for (let i = 0; i < width * height; i += 1) {
    const e = rgbe[i * 4 + 3];
    if (e > 0) {
      const scale = Math.pow(2, e - 128) / 256;
      rgb[i * 3 + 0] = rgbe[i * 4 + 0] * scale;
      rgb[i * 3 + 1] = rgbe[i * 4 + 1] * scale;
      rgb[i * 3 + 2] = rgbe[i * 4 + 2] * scale;
    }
  }

  return { width, height, rgb, rgba16: rgbFloatToRgba16Float(rgb, width * height) };
}

function decodeRgbe(bytes: Uint8Array, start: number, width: number, height: number): Uint8Array {
  let offset = start;
  const out = new Uint8Array(width * height * 4);
  const scanline = new Uint8Array(width * 4);

  for (let y = 0; y < height; y += 1) {
    const r = bytes[offset++];
    const g = bytes[offset++];
    const b = bytes[offset++];
    const e = bytes[offset++];

    if (r !== 2 || g !== 2 || (b & 0x80) !== 0) {
      out.set([r, g, b, e], (y * width + 0) * 4);
      for (let x = 1; x < width; x += 1) {
        out.set(bytes.slice(offset, offset + 4), (y * width + x) * 4);
        offset += 4;
      }
      continue;
    }

    const scanlineWidth = (b << 8) | e;
    if (scanlineWidth !== width) throw new Error("HDR scanline width mismatch.");

    for (let channel = 0; channel < 4; channel += 1) {
      let x = 0;
      while (x < width) {
        const count = bytes[offset++];
        if (count > 128) {
          const run = count - 128;
          const value = bytes[offset++];
          scanline.fill(value, channel * width + x, channel * width + x + run);
          x += run;
        } else {
          scanline.set(bytes.slice(offset, offset + count), channel * width + x);
          offset += count;
          x += count;
        }
      }
    }

    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4;
      out[dst + 0] = scanline[x];
      out[dst + 1] = scanline[width + x];
      out[dst + 2] = scanline[width * 2 + x];
      out[dst + 3] = scanline[width * 3 + x];
    }
  }

  return out;
}
