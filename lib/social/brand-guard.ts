// Letterlijke port van Social-media-tool/lib/brand-guard.js (gedrag byte-identiek,
// gecontroleerd met scripts/test-brand-guard-parity.mjs).
//
// Bewaakt de huisstijl van slides: vaste elementen (kader, logo, voetbalk)
// worden door code gezet in plaats van door Claude, zodat ze op elke slide
// identiek zijn. Daarnaast worden fonts en externe bronnen gecorrigeerd.

import type { Format } from "./formats";

const START = "<!-- lv:vast -->";
const END = "<!-- /lv:vast -->";
const BLOCK = /[ \t]*<!-- lv:vast -->[\s\S]*?<!-- \/lv:vast -->\n?/g;
const BRAND_LINK = '<link rel="stylesheet" href="../../../brand/brand.css">';
const ALLOWED_FONT = /lv-font|lv-mono|manrope|fragment mono|inherit|initial|unset/i;

const pad = (n: number) => String(n).padStart(2, "0");

function chromeMarkup(index: number, total: number): string {
  const multi = total > 1;
  const last = index === total - 1;
  const dots = multi
    ? `<div class="lv-dots">${Array.from({ length: total }, (_, i) =>
        `<span class="lv-dot${i === index ? " is-active" : ""}"></span>`).join("")}</div>`
    : "<span></span>";
  const left = multi ? `<span class="lv-mono">${pad(index + 1)} / ${pad(total)}</span>` : "<span></span>";
  const right = multi && !last ? "Swipe &rarr;" : "studio-levant.nl";
  return [
    `  ${START}`,
    `  <div class="lv-frame"></div>`,
    `  <header class="lv-header"><span class="lv-logo-banner" role="img" aria-label="Studio Levant"></span></header>`,
    `  <footer class="lv-footer">${left}${dots}<span class="lv-mono lv-right">${right}</span></footer>`,
    `  ${END}`,
    "",
  ].join("\n");
}

/** Haalt de vaste elementen weg (bijv. om ze niet naar Claude te sturen). */
export function stripChrome(html: string): string {
  return html.replace(BLOCK, "");
}

/** Zet de vaste elementen (opnieuw) direct na de opening van .slide. */
export function applyChrome(html: string, index: number, total: number): string {
  const clean = stripChrome(html);
  const open = clean.match(/<div\b[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>\n?/);
  if (!open || open.index === undefined) return clean;
  const at = open.index + open[0].length;
  return clean.slice(0, at) + (open[0].endsWith("\n") ? "" : "\n") + chromeMarkup(index, total) + clean.slice(at);
}

/**
 * Corrigeert AI-output naar de huisstijl: alleen brand.css als stylesheet,
 * geen scripts of externe fonts, en font-family altijd Manrope of Fragment Mono.
 * Geeft de gecorrigeerde html en een lijst met wat er is aangepast.
 */
export function enforceBrand(html: string): { html: string; fixes: string[] } {
  const fixes: string[] = [];
  let out = html;

  out = out.replace(/<script\b[\s\S]*?<\/script>\s*/gi, () => (fixes.push("script verwijderd"), ""));
  out = out.replace(/<link\b[^>]*>\s*/gi, (tag) => {
    if (/brand\/brand\.css/.test(tag)) return tag;
    fixes.push("externe stylesheet verwijderd");
    return "";
  });
  out = out.replace(/@import[^;]+;\s*/gi, () => (fixes.push("@import verwijderd"), ""));
  out = out.replace(/font-family\s*:\s*((?:"[^"]*"|'[^']*'|[^;}"'<])+)/gi, (decl, value: string) => {
    if (ALLOWED_FONT.test(value)) return decl;
    fixes.push(`font "${value.trim()}" vervangen door Manrope`);
    return "font-family: var(--lv-font)";
  });
  if (!out.includes("brand/brand.css")) {
    out = out.replace(/<head>/i, `<head>\n${BRAND_LINK}`);
    fixes.push("brand.css toegevoegd");
  }
  return { html: out, fixes };
}

/** Zet canvasmaat en formaat op <body>, zodat brand.css de juiste maten gebruikt. */
export function setCanvas(html: string, fmt: Format, formatKey: string): string {
  return html.replace(/<body\b[^>]*>/i, (tag) => {
    let t = tag.replace(/\sdata-format="[^"]*"/, "");
    t = /--w:\s*\d+px;\s*--h:\s*\d+px/.test(t)
      ? t.replace(/--w:\s*\d+px;\s*--h:\s*\d+px/, `--w:${fmt.w}px;--h:${fmt.h}px`)
      : t.replace(/<body/i, `<body style="--w:${fmt.w}px;--h:${fmt.h}px"`);
    return t.replace(/<body/i, `<body data-format="${formatKey}"`);
  });
}
