import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dbFout } from './api';
import { BeeldFout, beeldenVoorClaude, heicNaarJpeg, isHeicType, MELDING_FOTO_ONLEESBAAR, MELDING_HEIC_ONLEESBAAR } from './beeld';
import {
  beeldBlokken,
  combineer,
  heeftApiKey,
  MODEL,
  MODEL_TWEEDE,
  samenvoegen,
  systeemPrompt,
  tweedePogingNodig,
  vraagClaude,
  zekerheidTekst
} from './claude';
import { download, nieuwPad, upload, verwijder } from './opslag';
import {
  normaliseerUitgelezen,
  ontbreektMelding,
  ontbrekendeVelden,
  schrijfAiVelden,
  snuffelType,
  type Uitgave,
  type Uitgelezen
} from './model';
import { bestandenVan, leveranciers, moetUitgave, type BestandRij } from './repo';

// Bonnetjes en facturen automatisch uitlezen: bestanden uit Storage halen (HEIC eerst omzetten
// naar JPEG en die opslaan), Claude vragen (lib/uitgaven/claude.ts; eerst Sonnet, bij een leeg
// of onzeker verplicht veld nog één keer Sonnet), normaliseren (lib/uitgaven/model.ts) en alleen
// de lege velden vullen. Wat de gebruiker al heeft ingevuld, wordt nooit overschreven.

/** Ruim onder de requestlimiet van 32 MB. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Maximaal zoveel bestanden van één uitgave meesturen (bv. meerdere pagina's als foto). */
const MAX_BESTANDEN = 4;
/** Na zoveel ms geen tweede poging meer (de route heeft maxDuration 120). */
const TWEEDE_POGING_TOT_MS = 55_000;

/**
 * Zet een HEIC/HEIF-bestand om naar JPEG en vervangt het in Storage en in expense_files
 * (zelfde rij-id, zodat een Drive-kopie dezelfde blijft). Mislukt het opslaan, dan gebruiken
 * we de JPEG toch voor het uitlezen. Gooit BeeldFout als de HEIC onleesbaar is.
 */
async function vervangHeic(sb: SupabaseClient, uitgaveId: string, b: BestandRij, inhoud: Buffer): Promise<Buffer> {
  const t0 = Date.now();
  const { jpeg, width, height } = await heicNaarJpeg(inhoud);
  console.info(`[uitgaven] HEIC omgezet naar JPEG ${width}×${height} (${Math.round(jpeg.length / 1024)} kB, ${Date.now() - t0} ms)`);
  try {
    const naam = `${(b.file_name || 'bonnetje').replace(/\.[^.]+$/, '') || 'bonnetje'}.jpg`;
    const pad = nieuwPad(uitgaveId, naam, 'image/jpeg');
    await upload(pad, jpeg, 'image/jpeg');
    const { error } = await sb
      .from('expense_files')
      .update({ storage_path: pad, mime_type: 'image/jpeg', size_bytes: jpeg.length, file_name: naam.slice(0, 200) })
      .eq('id', b.id);
    if (error) {
      await verwijder([pad]);
      throw dbFout(error);
    }
    await verwijder([b.storage_path]);
  } catch (e) {
    console.error('[uitgaven] omgezette JPEG opslaan mislukt (uitlezen gaat door)', (e as Error)?.message ?? e);
  }
  return jpeg;
}

/** Zet alle HEIC/HEIF-bestanden van een uitgave om (ook zonder Claude: dan is er tenminste een voorbeeld). */
async function zetHeicOm(sb: SupabaseClient, uitgaveId: string, bestanden: BestandRij[]): Promise<Map<string, Buffer>> {
  const klaar = new Map<string, Buffer>();
  for (const b of bestanden.slice(0, MAX_BESTANDEN)) {
    if (!isHeicType(b.mime_type)) continue;
    const inhoud = await download(b.storage_path);
    if (!inhoud) continue;
    const echt = snuffelType(inhoud.subarray(0, 16));
    if (echt && !isHeicType(echt)) continue; // verkeerd gelabeld: inhoudVoor leest het gewoon
    try {
      klaar.set(b.id, await vervangHeic(sb, uitgaveId, b, inhoud));
    } catch (e) {
      console.error('[uitgaven] HEIC omzetten mislukt', (e as Error)?.message ?? e);
    }
  }
  return klaar;
}

/** Bouwt de berichtinhoud uit de bestanden; geeft ook de reden als niets bruikbaar was. */
async function inhoudVoor(bestanden: BestandRij[], omgezet: Map<string, Buffer>): Promise<{ blokken: ContentBlockParam[]; reden: string }> {
  const blokken: ContentBlockParam[] = [];
  let reden = 'Er is geen bestand om uit te lezen.';
  const meer = Math.min(bestanden.length, MAX_BESTANDEN) > 1;
  for (const [i, b] of bestanden.slice(0, MAX_BESTANDEN).entries()) {
    const inhoud = omgezet.get(b.id) ?? (await download(b.storage_path));
    if (!inhoud) {
      reden = 'Het bestand kon niet worden geopend. Upload het opnieuw.';
      continue;
    }
    const type = snuffelType(inhoud.subarray(0, 16)) ?? b.mime_type;
    const kop = meer ? `Bestand ${i + 1}. ` : '';
    if (type === 'application/pdf') {
      if (inhoud.length > MAX_PDF_BYTES) {
        reden = 'Deze PDF is te groot om automatisch uit te lezen (max. 20 MB).';
        continue;
      }
      if (meer) blokken.push({ type: 'text', text: `${kop}PDF:` });
      blokken.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: inhoud.toString('base64') } });
      continue;
    }
    try {
      blokken.push(...beeldBlokken(await beeldenVoorClaude(inhoud), kop));
    } catch (e) {
      if (e instanceof BeeldFout) {
        reden = isHeicType(type) ? MELDING_HEIC_ONLEESBAAR : e.code === 'onleesbaar' ? MELDING_FOTO_ONLEESBAAR : e.message;
      } else {
        console.error('[uitgaven] afbeelding klaarmaken', (e as Error)?.message ?? e);
        reden = MELDING_FOTO_ONLEESBAAR;
      }
    }
  }
  return { blokken, reden };
}

/** Haiku, en bij een leeg of onzeker verplicht veld nog één keer Sonnet. */
async function leesMetClaude(blokken: ContentBlockParam[], systeem: string, vandaag: string): Promise<Uitgelezen> {
  const start = Date.now();
  let eerste: Uitgelezen | null = null;
  try {
    eerste = normaliseerUitgelezen(await vraagClaude(blokken, systeem, { model: MODEL, timeoutMs: 45_000, maxRetries: 1 }), vandaag);
    console.info(`[uitgaven] ${MODEL} (${((Date.now() - start) / 1000).toFixed(1)} s): ${zekerheidTekst(eerste)}`);
  } catch (e) {
    console.warn(`[uitgaven] ${MODEL} mislukt: ${(e as Error)?.message ?? e}`);
  }
  const nodig = eerste ? tweedePogingNodig(eerste) : ['leverancier', 'datum', 'totaal'];
  if (!nodig.length) return eerste!;
  if (Date.now() - start > TWEEDE_POGING_TOT_MS) {
    if (eerste) return eerste;
    throw new Error('Uitlezen duurde te lang.');
  }
  const t1 = Date.now();
  try {
    const tweede = normaliseerUitgelezen(
      await vraagClaude(blokken, systeem, { model: MODEL_TWEEDE, effort: 'high', timeoutMs: 55_000, maxRetries: 0 }),
      vandaag
    );
    console.info(`[uitgaven] tweede poging ${MODEL_TWEEDE} voor ${nodig.join(', ')} (${((Date.now() - t1) / 1000).toFixed(1)} s): ${zekerheidTekst(tweede)}`);
    if (!eerste) return tweede;
    const { r, bron } = combineer(eerste, tweede);
    const naam = { eerste: MODEL, tweede: MODEL_TWEEDE, geen: 'geen' } as const;
    console.info(`[uitgaven] gecombineerd: ${(['leverancier', 'datum', 'totaal'] as const).map((v) => `${v} van ${naam[bron[v]]}`).join(', ')}; ${zekerheidTekst(r)}`);
    return r;
  } catch (e) {
    console.warn(`[uitgaven] tweede poging ${MODEL_TWEEDE} mislukt: ${(e as Error)?.message ?? e}`);
    if (eerste) return eerste;
    throw e;
  }
}

/**
 * Leest de bestanden van een uitgave uit en vult de lege velden. Gooit nooit vanwege
 * Claude: een mislukking wordt ai_status 'mislukt' met een melding, zodat de gebruiker
 * gewoon zelf invult. Geeft de bijgewerkte uitgave terug.
 */
export async function leesUitgaveUit(sb: SupabaseClient, id: string, vandaag: string): Promise<Uitgave> {
  const { uitgave } = await moetUitgave(sb, id);
  let kolommen: Record<string, unknown>;

  // HEIC eerst omzetten, ook zonder API-key: dan kan elke browser de foto tenminste tonen.
  let bestanden = await bestandenVan(sb, id);
  let omgezet = new Map<string, Buffer>();
  try {
    omgezet = await zetHeicOm(sb, id, bestanden);
    if (omgezet.size) bestanden = await bestandenVan(sb, id);
  } catch (e) {
    console.error('[uitgaven] HEIC omzetten', (e as Error)?.message ?? e);
  }

  if (!heeftApiKey()) {
    kolommen = {
      ai_status: 'mislukt',
      ai_message: 'Automatisch uitlezen staat uit (geen ANTHROPIC_API_KEY op de server). Vul de velden zelf in.'
    };
  } else {
    try {
      const bekend = await leveranciers(sb);
      const { blokken, reden } = await inhoudVoor(bestanden, omgezet);
      if (!blokken.length) {
        kolommen = { ai_status: 'mislukt', ai_message: reden };
      } else {
        const r = await leesMetClaude(blokken, systeemPrompt(vandaag, bekend), vandaag);
        const s = samenvoegen(uitgave, r, bekend);
        // Ontbreekt na het uitlezen nog een verplicht veld (leverancier, datum, bedrag), dan
        // zegt de melding welk; de app markeert die velden en vraagt ze zelf in te vullen.
        const ontbreekt = ontbrekendeVelden({
          leverancier: (s.kolommen.supplier as string | undefined) ?? uitgave.leverancier,
          datum: (s.kolommen.expense_date as string | undefined) ?? uitgave.datum,
          totaal: (s.kolommen.total_amount as number | undefined) ?? uitgave.totaal
        });
        kolommen = {
          ...s.kolommen,
          ai_fields: schrijfAiVelden([...uitgave.aiVelden, ...s.velden], [...uitgave.aiOnzeker, ...s.onzeker]),
          ai_status: 'klaar',
          ai_message: ontbreekt.length
            ? ontbreektMelding(ontbreekt)
            : s.velden.length
              ? ''
              : 'Er is niets nieuws gevonden om in te vullen.'
        };
      }
    } catch (e) {
      console.error('[uitgaven] uitlezen', (e as Error)?.message ?? e);
      kolommen = { ai_status: 'mislukt', ai_message: 'Automatisch uitlezen is niet gelukt. Vul de velden zelf in.' };
    }
  }

  const { error } = await sb.from('expenses').update(kolommen).eq('id', id);
  if (error) throw dbFout(error);
  return (await moetUitgave(sb, id)).uitgave;
}
