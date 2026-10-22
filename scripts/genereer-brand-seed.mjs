// Eenmalig hulpscript: maakt supabase/migrations/0016_social_brand_seed.sql aan uit
// de huisstijlbestanden van de oude Social-media-tool. Leest de bron alleen, schrijft
// uitsluitend het migratiebestand in deze repo. Voert niets uit tegen Supabase.
//
// Gebruik:  node scripts/genereer-brand-seed.mjs [pad/naar/Social-media-tool]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.resolve(process.argv[2] || path.join(ROOT, "..", "Social-media-tool"));
const OUT = path.join(ROOT, "supabase", "migrations", "0016_social_brand_seed.sql");
const TAG = "$brand$";

const css = fs.readFileSync(path.join(SRC, "brand", "brand.css"), "utf8");
const guide = fs.readFileSync(path.join(SRC, "brand", "huisstijl.md"), "utf8");

for (const [name, text] of [["brand.css", css], ["huisstijl.md", guide]]) {
  if (text.includes(TAG)) {
    console.error(`${name} bevat "${TAG}"; kies een andere dollar-quote-tag.`);
    process.exit(1);
  }
}

const sql = `-- Startwaarde voor de huisstijl van de social media-module: de inhoud van
-- brand/brand.css en brand/huisstijl.md uit de oude Social-media-tool.
-- Gegenereerd met scripts/genereer-brand-seed.mjs. Bestaat de rij al (bijv. omdat de
-- huisstijl in de app is aangepast), dan verandert deze migratie niets.
insert into public.social_brand (id, css, guide)
values (
  1,
  ${TAG}${css}${TAG},
  ${TAG}${guide}${TAG}
)
on conflict (id) do nothing;
`;

fs.writeFileSync(OUT, sql);
console.log(`Geschreven: ${path.relative(ROOT, OUT)} (css ${css.length} tekens, huisstijl ${guide.length} tekens)`);
