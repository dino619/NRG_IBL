export function hexToLinearRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const srgb = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return srgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as [
    number,
    number,
    number,
  ];
}
