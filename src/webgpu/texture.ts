export function createDepthTexture(device: GPUDevice, width: number, height: number): GPUTexture {
  return device.createTexture({
    label: "depth",
    size: { width: Math.max(1, width), height: Math.max(1, height) },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

export function writeRgba16FloatTexture(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  data: Uint16Array,
): void {
  device.queue.writeTexture(
    { texture },
    data as GPUAllowSharedBufferSource,
    {
      offset: 0,
      bytesPerRow: width * 8,
      rowsPerImage: height,
    },
    { width, height, depthOrArrayLayers: 1 },
  );
}
