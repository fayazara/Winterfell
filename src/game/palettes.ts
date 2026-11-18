export type RGB = [number, number, number]

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace("#", ""), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** Max colours the post shader accepts. */
export const MAX_PALETTE = 64

/** Painterly daylight: lavender skies, slate mountains, rich valley greens. */
const PAINTERLY = [
  // sky / cloud blues and lavenders
  "#1e2040", "#2c3060", "#3c4282", "#4a52a0", "#5a64b4", "#6e7ac4",
  "#8a94d0", "#a8b0e0", "#c8ccec", "#e6e8f6",
  // purple greys: mountains, castle, shadow
  "#16141e", "#24202e", "#322c40", "#443c56", "#574e6c", "#6c6284",
  "#847a9c", "#a198b6",
  // greens
  "#0e1a12", "#16281a", "#203a22", "#2c4c2a", "#3a6032", "#4c743a",
  "#608a42", "#78a04c", "#94b65a", "#b2c86e",
  // ochre meadow
  "#6a6a2c", "#8e8a3a", "#c0b060", "#e0d088",
  // earth / wood / leather
  "#1a1210", "#2e1e16", "#46301e", "#604228", "#7c5634", "#9a6e44", "#b88a5a",
  // stone / cream
  "#8a8478", "#aaa292", "#c8bea8", "#e2d8c0",
  // roofs, flowers
  "#5a2420", "#82342a", "#a84a32", "#c8643a", "#e08a4a",
  // skin
  "#6a3a26", "#8e5236", "#b06e48", "#cc8c60", "#e2ac80",
  // steel
  "#3a3e4a", "#5a6070", "#7e8696", "#a6aebc", "#d0d6e0",
  // fire
  "#f0a040", "#f8d070", "#fff4c8",
  "#08080c",
]

/** Violet sunset: saturated purples and magentas, gold highlights, lush greens. */
const VIOLET = [
  "#08060e", "#1a1030", "#2a1a4a", "#3a2468", "#4a2e86", "#5c3a9e", "#7048b4",
  "#8a5cc8", "#a878d8", "#c49ae6",
  "#5a2060", "#8a2a70", "#b83a7a", "#e0548a", "#f27aa0", "#f8a0b4", "#fcc8cc",
  "#f89a6a", "#fcc070", "#f8e07a", "#fff4b0",
  "#24305a", "#34488a", "#4a62b0", "#6a86cc", "#9ab0e0",
  "#0e2420", "#143428", "#1c4a30", "#2a6236", "#3e7a3a", "#5a9440", "#80ac44",
  "#a8c450", "#d0d860",
  "#2a1a1a", "#4a2a26", "#6e3e30", "#9a5a3a",
  "#a83a2a", "#d8583a",
  "#6a5e7a", "#9a8aa4", "#c8bac8", "#f0e8f0",
  "#8e5236", "#b06e48", "#e2ac80", "#5a6070", "#a6aebc",
]

/** Gothic: the original moody dusk palette (fewer, darker colours). */
const GOTHIC = [
  "#07060d", "#0f0d1c", "#171530", "#221f45", "#2e2a5c", "#3d3873",
  "#514a8c", "#6a62a6", "#8a83c2", "#b4aee0",
  "#1c1a24", "#2a2833", "#3f3c4a", "#5a5666", "#7a7686", "#a19dab", "#c9c6e8",
  "#0b1513", "#0f1a17", "#17281f", "#223a2a", "#34503a", "#4d6b47",
  "#3a2140", "#5c2f5a", "#8a3f5e", "#c25a5e", "#e07a52",
  "#1a100c", "#2b1a14", "#4a2a1c", "#6e3b22", "#9a5428", "#c9772f",
  "#e8a040", "#f6d27a", "#fff3c4",
]

export const PALETTES: Record<string, { name: string; colors: RGB[] }> = {
  violet: { name: "Violet sunset", colors: VIOLET.map(hexToRgb) },
  painterly: { name: "Painterly", colors: PAINTERLY.map(hexToRgb) },
  gothic: { name: "Gothic", colors: GOTHIC.map(hexToRgb) },
}

export type PaletteId = keyof typeof PALETTES | "off"
