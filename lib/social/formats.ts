// Letterlijke port van Social-media-tool/lib/formats.js.

export type Format = { label: string; w: number; h: number };

export const FORMATS: Record<string, Format> = {
  "ig-portrait": { label: "Instagram staand 4:5", w: 1080, h: 1350 },
  "ig-square": { label: "Instagram vierkant 1:1", w: 1080, h: 1080 },
  story: { label: "Story / Reel 9:16", w: 1080, h: 1920 },
  "linkedin-portrait": { label: "LinkedIn carousel 4:5", w: 1080, h: 1350 },
  "linkedin-square": { label: "LinkedIn vierkant 1:1", w: 1080, h: 1080 },
  "linkedin-landscape": { label: "LinkedIn liggend", w: 1200, h: 627 },
};

export function isFormat(key: unknown): key is string {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(FORMATS, key);
}

export function getFormat(key: string): Format {
  return (isFormat(key) && FORMATS[key]) || FORMATS["ig-portrait"];
}
