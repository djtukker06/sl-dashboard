-- Startwaarde voor de huisstijl van de social media-module: de inhoud van
-- brand/brand.css en brand/huisstijl.md uit de oude Social-media-tool.
-- Gegenereerd met scripts/genereer-brand-seed.mjs. Bestaat de rij al (bijv. omdat de
-- huisstijl in de app is aangepast), dan verandert deze migratie niets.
insert into public.social_brand (id, css, guide)
values (
  1,
  $brand$/* ==========================================================================
   Studio Levant — huisstijl voor social posts
   Elke slide linkt naar dit bestand. Pas je hier iets aan, dan verandert
   het in alle posts tegelijk.
   ========================================================================== */

@import url("https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Fragment+Mono&display=block");

:root {
  /* Kleuren (overgenomen van studio-levant.nl) */
  --lv-dark: #292929;      /* hoofdachtergrond */
  --lv-darker: #232323;    /* diepere variant */
  --lv-charcoal: #3c3b3b;  /* vlakken, lijnen op donker */
  --lv-grey: #868382;      /* secundaire tekst */
  --lv-sand: #e3dedb;      /* hoofdtekst op donker, accentvlak */
  --lv-sand-soft: #efebe8; /* lichte achtergrond */

  /* Typografie */
  --lv-font: "Manrope", system-ui, sans-serif;
  --lv-mono: "Fragment Mono", ui-monospace, monospace;

  /* Ritme */
  --lv-margin: 88px;       /* veilige marge rondom */
  --lv-radius: 6px;
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--lv-dark);
}

/* Canvas: breedte/hoogte komen uit --w en --h op <body> */
.slide {
  position: relative;
  width: var(--w, 1080px);
  height: var(--h, 1350px);
  overflow: hidden;
  background: var(--lv-dark);
  color: var(--lv-sand);
  font-family: var(--lv-font);
  font-weight: 500;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.01em;
}

.slide.lv-light {
  background: var(--lv-sand);
  color: var(--lv-dark);
}

/* Inkt-tinten per thema: niet alle tekst exact dezelfde kleur */
.slide {
  --lv-ink: var(--lv-sand);
  --lv-ink-soft: var(--lv-grey);
  --lv-line: var(--lv-charcoal);
}
.slide.lv-light {
  --lv-ink: var(--lv-dark);
  --lv-ink-soft: #5e5b5a;
  --lv-line: rgba(41, 41, 41, 0.16);
}

/* Koppen: Manrope bold, uppercase (huisstijlregel: titels altijd bold) */
.lv-h1 {
  font-size: 104px;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.02em;
  margin: 0;
}
.lv-h2 {
  font-size: 68px;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.015em;
  margin: 0;
}

/* Titelblok zoals goedgekeurd: korte aanloopregel + groot kernwoord + subtekst */
.lv-title-lead {
  font-size: 52px;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  margin: 0;
}
.lv-title-big {
  font-size: 128px;
  line-height: 1.1;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: -0.02em;
  margin: 6px 0 0;
}
.lv-sub {
  margin: 24px 0 0;
  font-size: 30px;
  line-height: 1.4;
  font-weight: 400;
  color: var(--lv-ink-soft);
}
.lv-body {
  font-size: 34px;
  line-height: 1.4;
  font-weight: 400;
  margin: 0;
}

/* Omgekeerd accentblok, zoals "CREATIVITEIT" op de website */
.lv-highlight {
  display: inline-block;
  background: var(--lv-sand);
  color: var(--lv-dark);
  padding: 0 0.08em;
  border-radius: 0.045em;   /* licht afgerond blok, zoals op de website */
  line-height: 1.1;
}
.lv-light .lv-highlight {
  background: var(--lv-dark);
  color: var(--lv-sand);
}

/* Kleine monospace labels (categorie, slidenummer, url) */
.lv-mono {
  font-family: var(--lv-mono);
  font-size: 24px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--lv-grey);
}

/* Woordmerk "Levant" zoals rechtsonder op de website */
.lv-wordmark {
  font-weight: 600;
  font-size: 64px;
  letter-spacing: -0.02em;
  line-height: 1;
}

.lv-logo {
  display: block;
  width: 96px;
  height: auto;
}

.lv-rule {
  height: 2px;
  background: var(--lv-charcoal);
  border: 0;
  margin: 0;
}
.lv-light .lv-rule { background: rgba(41, 41, 41, 0.18); }


/* ==========================================================================
   VASTE ELEMENTEN (kader, kop met logo, voetbalk)
   Deze worden door de studio automatisch in elke slide gezet, tussen
   <!-- lv:vast --> en <!-- /lv:vast -->. Pas ze hier aan, dan veranderen
   ze in alle posts tegelijk. Ontwerp de inhoud tussen
   var(--lv-content-top) en var(--lv-content-bottom).
   ========================================================================== */

body {
  --lv-frame-inset: 40px;
  --lv-header-top: 84px;
  --lv-logo-h: 64px;
  --lv-logo-mark: 48px;
  --lv-logo-tekst: 30px;
  --lv-footer-bottom: 84px;
  --lv-content-top: 210px;     /* inhoud begint onder het logo */
  --lv-content-bottom: 180px;  /* ruimte boven de voetbalk */
}
body[data-format="story"] {
  --lv-header-top: 220px;      /* Instagram-balk bovenin vrijhouden */
  --lv-footer-bottom: 280px;   /* reactieveld onderin vrijhouden */
  --lv-content-top: 350px;
  --lv-content-bottom: 380px;
}
body[data-format="linkedin-landscape"] {
  --lv-frame-inset: 22px;
  --lv-header-top: 44px;
  --lv-logo-h: 40px;
  --lv-logo-mark: 30px;
  --lv-logo-tekst: 20px;
  --lv-footer-bottom: 44px;
  --lv-content-top: 120px;
  --lv-content-bottom: 100px;
  --lv-margin: 64px;
}

.lv-frame {
  position: absolute;
  inset: var(--lv-frame-inset);
  border: 2px solid var(--lv-line);
  border-radius: 28px;
  pointer-events: none;
  z-index: 3;
}

.lv-header {
  position: absolute;
  top: var(--lv-header-top);
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  z-index: 4;
}
/* Het logo kleurt automatisch mee: zand op donker, donker op licht */
.lv-logo-banner {
  display: block;
  height: var(--lv-logo-h);
  aspect-ratio: 1600 / 594;
  background: var(--lv-ink);
  -webkit-mask: url("logo-compact-licht.png") center / contain no-repeat;
  mask: url("logo-compact-licht.png") center / contain no-repeat;
}

/* Kop: beeldmerk + naam, zoals op de post "Dit is Studio Levant".
   Kleurt mee: zand op donker, donker op licht. */
.lv-header { align-items: center; gap: 16px; }
.lv-logo {
  display: block;
  width: var(--lv-logo-mark);
  height: var(--lv-logo-mark);
  background: var(--lv-ink);
  -webkit-mask: url("logo-licht.png") center / contain no-repeat;
  mask: url("logo-licht.png") center / contain no-repeat;
}
.lv-logo-tekst {
  font-size: var(--lv-logo-tekst);
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--lv-ink);
}

.lv-footer {
  position: absolute;
  left: var(--lv-margin);
  right: var(--lv-margin);
  bottom: var(--lv-footer-bottom);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  z-index: 4;
}
.lv-footer .lv-mono { font-size: 22px; color: var(--lv-ink-soft); }
.lv-footer .lv-right { text-align: right; }
.lv-dots { display: flex; gap: 12px; }
.lv-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--lv-line);
}
.lv-light .lv-dot { background: rgba(41, 41, 41, 0.2); }
.lv-dot.is-active { background: var(--lv-ink); }
$brand$,
  $brand$# Studio Levant — huisstijl en tone of voice

Deze tekst gaat bij elke generatie mee naar Claude. Pas hem gerust aan.

## Over het bedrijf
Studio Levant is een creatief bureau uit Almelo. We combineren creativiteit met strategie
en realiseren resultaatgerichte ontwerpen. We staan voor kwaliteit, functionaliteit en oog voor detail.
Slogan op de website: "Waar creativiteit geen grenzen kent".
Website: studio-levant.nl

## Visuele stijl
- Overwegend donker (#292929) met warm zandkleurige tekst (#E3DEDB). Lichte slides (zand als achtergrond, donkere tekst) mogen als afwisseling.
- Geen felle kleuren. Het palet is bewust ingetogen: donker, zand, warmgrijs (#868382) en antraciet (#3C3B3B).
- Koppen in Manrope **bold**, uppercase, groot en strak. Eén kernwoord mag als omgekeerd blok (class `lv-highlight`), zoals "CREATIVITEIT" op de website.
- Kleine details in Fragment Mono (monospace, uppercase): labels, slidenummers, url.
- Veel lucht, duidelijke grid, links uitgelijnd. Minimalistisch en premium, niet druk.
- Het beeldmerk (hexagon met golvende lijnen) mag groot en deels buiten beeld als heel subtiel achtergrondelement (maximaal 4% dekking).

## Vaste regels voor elke post
Deze regels komen uit eerdere feedback en gelden altijd:
1. Het logo staat op elke slide op exact dezelfde plek bovenaan (wordt automatisch geplaatst), met kader en voetbalk.
2. Alle titels in Manrope bold, uppercase. Titelblok: korte aanloopregel, groot kernwoord (eventueel als accentblok) en een subtekst eronder. Titel staat op elke slide op dezelfde hoogte.
3. De subtekst onder een titel heeft overal dezelfde stijl (lv-sub). Gebruik geen afwijkende "losse" zinnetjes met een andere opmaak.
4. Rustig en luchtig, nooit druk. Liever minder elementen en meer ruimte tussen punten. Het mag niet "gegenereerd" of "vibe-coded" ogen: geen overbodige lijnen, badges, pillen of decoratie.
5. Niet alle tekst exact dezelfde kleur: titels in de hoofdtint, lopende tekst net iets zachter (lv-ink en lv-ink-soft).
6. Geen knoppen of knop-achtige elementen: op Instagram kun je niet klikken. Een call-to-action is tekst, bijv. "Stuur ons een DM" of "studio-levant.nl".
7. Wissel donkere en lichte slides af als dat het verhaal helpt.
8. Opeenvolgende slides met een lijst of stappen moeten duidelijk anders gevisualiseerd zijn, maar binnen hetzelfde systeem blijven.

## Tone of voice
- Nederlands, je-vorm, zelfverzekerd maar niet schreeuwerig.
- Korte, krachtige zinnen. Geen clichés of overdreven marketingtaal, geen emoji's in de slides.
- Inhoudelijk en behulpzaam: laat vakmanschap zien.
$brand$
)
on conflict (id) do nothing;
