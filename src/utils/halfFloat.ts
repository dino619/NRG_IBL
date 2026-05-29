export function float32ToFloat16(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Infinity) return 0x7c00;
  if (value === -Infinity) return 0xfc00;

  const sign = value < 0 ? 0x8000 : 0;
  const abs = Math.abs(value);
  if (abs === 0) return sign;
  if (abs > 65504) return sign | 0x7bff;

  if (abs < 0.00006103515625) {
    return sign | Math.round(abs / 0.000000059604644775390625);
  }

  const exponent = Math.floor(Math.log2(abs));
  const mantissa = abs / Math.pow(2, exponent) - 1;
  const halfExp = exponent + 15;
  const halfMantissa = Math.round(mantissa * 1024);
  return sign | (halfExp << 10) | (halfMantissa & 0x3ff);
}

export function rgbFloatToRgba16Float(rgb: Float32Array, pixelCount: number): Uint16Array {
  const out = new Uint16Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i += 1) {
    out[i * 4 + 0] = float32ToFloat16(rgb[i * 3 + 0]);
    out[i * 4 + 1] = float32ToFloat16(rgb[i * 3 + 1]);
    out[i * 4 + 2] = float32ToFloat16(rgb[i * 3 + 2]);
    out[i * 4 + 3] = float32ToFloat16(1);
  }
  return out;
}
