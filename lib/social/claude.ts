// Port van Social-media-tool/lib/claude.js. Model, max_tokens, thinking, effort, beta en
// fallbacks zijn identiek. Verschillen: de huisstijl komt als strings binnen (uit de
// database in plaats van uit brand/), en het beeldmateriaal wordt async uit Supabase
// Storage gehaald in plaats van van schijf gelezen.

import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getFormat } from "./formats";
import { stripChrome } from "./brand-guard";
import { downloadAsset, mediaType, type Brand, type Project, type Slide } from "./repo";

const MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;

export function resetClient() {
  client = null;
}

function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function systemPrompt({ css, guide }: Brand) {
  return `Je bent de senior art director en copywriter van Studio Levant. Je ontwerpt social media posts als HTML-bestanden die later met een headless browser naar PNG worden gerenderd. Elke slide moet er op zichzelf als een af, premium ontwerp uitzien en exact binnen het canvas passen.

# Huisstijl
${guide}

# brand.css (wordt in elke slide geladen, gebruik de variabelen en classes)
\`\`\`css
${css}
\`\`\`

# Technische regels voor elke slide
Elke slide is één volledig HTML-document met precies deze opbouw:

<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="../../../brand/brand.css">
<style>
  /* stijlen voor deze slide */
</style>
</head>
<body style="--w:{BREEDTE}px;--h:{HOOGTE}px">
<div class="slide">            (of class="slide lv-light" voor een lichte slide)
  ...inhoud...
</div>
</body>
</html>

- Het canvas is exact {BREEDTE}×{HOOGTE} pixels (staat in de opdracht). Alles moet binnen .slide passen; .slide heeft overflow hidden, dus tekst die niet past valt weg. Reken de ruimte na: tel regels × line-height. Liever minder tekst of een kleinere kop dan overloop.
- Positioneer met flexbox/grid binnen .slide of met position:absolute. Houd minimaal var(--lv-margin) marge aan de randen voor tekst.
- Leesbaarheid op een telefoon: lopende tekst minimaal 30px, labels minimaal 22px.
- Lettertypen alleen Manrope (var(--lv-font)) en Fragment Mono (var(--lv-mono)). Andere fonts, externe stylesheets en JavaScript worden automatisch verwijderd.
- Kleuren alleen uit het palet in brand.css. Gebruik voor tekst de tinten var(--lv-ink) (titels) en var(--lv-ink-soft) (lopende tekst) en voor lijnen var(--lv-line); die passen zich automatisch aan op donkere en lichte slides.
- Beeldmerk als subtiel achtergrondelement (maximaal 4% dekking): ../../../brand/logo-licht.png op donker, ../../../brand/logo-donker.png op licht.
- Aangeleverd beeldmateriaal staat in ../assets/<bestandsnaam>. Gebruik alleen die bestanden als foto; verzin geen andere afbeeldingspaden. Gebruik object-fit: cover voor foto's.
- Iconen of grafische vormen maak je met inline SVG of CSS.
- Gebruik class-namen en stijlen per slide in het <style>-blok, netjes en leesbaar opgemaakt: de gebruiker past de HTML later zelf aan.

# Vaste elementen (kader, logo, slidenummer)
Als de opdracht zegt dat de vaste elementen AAN staan, plaatst de studio zelf in elke slide: een afgerond kader, het Studio Levant-logo gecentreerd bovenaan en een voetbalk met slidenummer, stipjes en "Swipe →". Maak deze dus NIET zelf: geen eigen logo bovenaan, geen kader, geen slidenummer, geen voetbalk.
- Ontwerp je inhoud binnen dit gebied: top: var(--lv-content-top); bottom: var(--lv-content-bottom); left en right: var(--lv-margin). Gebruik bijvoorbeeld een wrapper met position:absolute en die vier waarden.
- Kies per slide het thema met class "lv-light" op .slide; het logo en de voetbalk kleuren automatisch mee.
Staan de vaste elementen UIT, ontwerp dan zelf een vaste kop en voet die op alle slides identiek zijn.

# Carousel
- Slides vormen één consistent systeem: zelfde grid, marges, titelpositie en typografie op elke slide.
- Gebruik voor titels het titelblok uit brand.css: .lv-title-lead (korte aanloop), .lv-title-big (kernwoord, eventueel in .lv-highlight) en .lv-sub (subtekst). Zet het op elke slide op dezelfde hoogte.
- Slide 1 is de hook: één sterke kop die nieuwsgierig maakt. De laatste slide is een afsluiter met een duidelijke call-to-action (bijv. volgen, bericht sturen, studio-levant.nl).
- Wissel donker en licht bewust af als dat het verhaal helpt, niet willekeurig.

# Inhoud
- Gebruik de tekst en uitleg van de gebruiker trouw: de kernboodschap en feiten daaruit zijn leidend. Je mag inkorten en herschrijven voor het formaat.
- Inspiratiebeelden geven richting voor sfeer, compositie en opbouw. Kopieer ze niet letterlijk en neem nooit kleuren of fonts over die buiten de huisstijl vallen.
- Schrijf in het Nederlands, tenzij de opdracht anders vraagt.

# Uitvoerformaat
Antwoord met uitsluitend deze blokken, zonder uitleg ervoor of erna en zonder markdown-codeblokken:

<caption>
De begeleidende posttekst voor het platform (met eventuele hashtags onderaan).
</caption>
<slide>
...volledig HTML-document van slide 1...
</slide>
<slide>
...volledig HTML-document van slide 2...
</slide>

Wordt je gevraagd om één slide aan te passen, geef dan alleen één <slide>-blok terug (geen caption).`;
}

function imageBlock(file: string, bytes: Buffer): BetaImageBlockParam {
  const type = mediaType(file);
  const media = (type === "application/octet-stream" ? "image/jpeg" : type) as
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp";
  return {
    type: "image",
    source: { type: "base64", media_type: media, data: bytes.toString("base64") },
  };
}

function briefText(project: Project) {
  const b = (project.brief || {}) as Record<string, string | undefined>;
  const fmt = getFormat(project.format);
  const lines = [
    `# Opdracht: ${project.name}`,
    `Formaat: ${fmt.label}, canvas ${fmt.w}×${fmt.h} px (gebruik dus --w:${fmt.w}px;--h:${fmt.h}px).`,
    `Aantal slides: ${b.slideCount ? b.slideCount : "kies zelf wat het verhaal nodig heeft (meestal 1 tot 8)"}.`,
    `Vaste elementen (kader, logo, slidenummer): ${project.brandChrome ? "AAN — maak ze niet zelf" : "UIT"}.`,
  ];
  if (b.topic) lines.push(`\n## Onderwerp\n${b.topic}`);
  if (b.text) lines.push(`\n## Tekst / kernboodschap (van de gebruiker)\n${b.text}`);
  if (b.explanation) lines.push(`\n## Uitleg en wensen\n${b.explanation}`);
  if (b.audience) lines.push(`\n## Doelgroep\n${b.audience}`);
  if (b.cta) lines.push(`\n## Call-to-action\n${b.cta}`);
  const links = (project.links || []).filter(Boolean);
  if (links.length) lines.push(`\n## Inspiratielinks (alleen ter referentie)\n${links.map((l) => `- ${l}`).join("\n")}`);
  return lines.join("\n");
}

async function mediaBlocks(project: Project): Promise<BetaContentBlockParam[]> {
  const assets = project.assets || [];
  // Parallel downloaden, daarna in de oorspronkelijke volgorde toevoegen.
  const files = await Promise.all(assets.map((a) => downloadAsset(project.id, a.file)));
  const blocks: BetaContentBlockParam[] = [];
  assets.forEach((a, i) => {
    const bytes = files[i];
    if (!bytes) return; // zoals `if (!fs.existsSync(file)) continue;`
    if (a.kind === "inspiratie") {
      blocks.push({ type: "text", text: `Inspiratiebeeld${a.note ? ` — ${a.note}` : ""}:` });
    } else {
      blocks.push({
        type: "text",
        text: `Beeldmateriaal om te gebruiken, pad: ../assets/${a.file}${a.note ? ` — ${a.note}` : ""}:`,
      });
    }
    blocks.push(imageBlock(a.file, bytes));
  });
  return blocks;
}

function slidesContext(slides: Slide[]) {
  return slides.map((s, i) => `<slide nummer="${i + 1}">\n${stripChrome(s.html)}\n</slide>`).join("\n");
}

export type Mode = "new" | "revise-all" | "revise-one";

export async function buildMessages({
  project,
  mode,
  feedback,
  slides,
  targetIndex,
}: {
  project: Project;
  mode: Mode;
  feedback: string;
  slides: Slide[];
  targetIndex: number;
}): Promise<BetaMessageParam[]> {
  const content: BetaContentBlockParam[] = [...(await mediaBlocks(project)), { type: "text", text: briefText(project) }];

  if (mode === "new") {
    content.push({ type: "text", text: "Ontwerp nu de complete post." });
  } else if (mode === "revise-all") {
    content.push({
      type: "text",
      text: `## Huidige versie\n<caption>\n${project.caption || ""}\n</caption>\n${slidesContext(slides)}\n\n## Feedback\n${feedback}\n\nPas de post aan op basis van deze feedback. Geef de complete post terug (caption en alle slides), en laat ongewijzigd wat niet genoemd wordt.`,
    });
  } else if (mode === "revise-one") {
    content.push({
      type: "text",
      text: `## Huidige slides (ter context)\n${slidesContext(slides)}\n\n## Aan te passen: slide ${targetIndex + 1}\nFeedback: ${feedback}\n\nGeef alleen de aangepaste slide ${targetIndex + 1} terug als één <slide>-blok. Houd hem consistent met de andere slides.`,
    });
  }
  return [{ role: "user", content }];
}

/**
 * Streamt een generatie. onText krijgt de tekst-delta's, resolve geeft de volledige tekst.
 */
export async function generate({
  brand,
  messages,
  onText,
  signal,
}: {
  brand: Brand;
  messages: BetaMessageParam[];
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const stream = getClient().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: systemPrompt(brand), cache_control: { type: "ephemeral" } }],
      messages,
    },
    { signal },
  );

  stream.on("text", (delta) => onText?.(delta));
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("Claude heeft deze opdracht geweigerd. Pas de briefing aan en probeer opnieuw.");
  }
  // Bij een server-side fallback staat de (afgebroken) tekst van het eerste model vóór het
  // fallback-blok; alleen de tekst daarna is het echte antwoord.
  const lastFallback = message.content.findLastIndex((b) => b.type === "fallback");
  const text = message.content
    .slice(lastFallback + 1)
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  if (message.stop_reason === "max_tokens") {
    throw new Error("Het antwoord was te lang en is afgebroken. Probeer minder slides.");
  }
  return text;
}

export function parseOutput(text: string): { caption: string | null; slides: string[] } {
  const caption = text.match(/<caption>([\s\S]*?)<\/caption>/i)?.[1]?.trim() ?? null;
  const slides = [...text.matchAll(/<slide[^>]*>([\s\S]*?)<\/slide>/gi)].map((m) => normalizeSlide(m[1]));
  return { caption, slides };
}

function normalizeSlide(html: string) {
  let s = html.trim().replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!/^<!doctype/i.test(s)) s = `<!doctype html>\n${s}`;
  return s + "\n";
}

export function countSlides(text: string) {
  return (text.match(/<slide[^>]*>/gi) || []).length;
}
