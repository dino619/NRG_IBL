export interface WebGPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not available. Use a current Chrome or Edge build with WebGPU enabled.");
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter was found.");

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("Could not create a WebGPU canvas context.");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  return { adapter, device, context, format };
}
