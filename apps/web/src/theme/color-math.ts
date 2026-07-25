interface Channels {
  red: number;
  green: number;
  blue: number;
}

function channels(hex: string): Channels {
  const value = hex.replace("#", "");
  const [red, green, blue] = [0, 2, 4].map(
    (index) => parseInt(value.slice(index, index + 2), 16) / 255,
  );
  return { red: red ?? 0, green: green ?? 0, blue: blue ?? 0 };
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearizeChannels({ red, green, blue }: Channels): Channels {
  return { red: linearize(red), green: linearize(green), blue: linearize(blue) };
}

/** Perceptual lightness in OKLab, 0 (black) to 1 (white). */
export function oklabLightness(hex: string): number {
  const { red, green, blue } = linearizeChannels(channels(hex));
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
}

function relativeLuminance(hex: string): number {
  const { red, green, blue } = linearizeChannels(channels(hex));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
