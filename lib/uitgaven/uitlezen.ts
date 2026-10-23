import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dbFout } from './api';
import { heeftApiKey, samenvoegen, systeemPrompt, vraagClaude } from './claude';
import { download } from './opslag';
import { normaliseerUitgelezen, ontbreektMelding, ontbrekendeVelden, schrijfAiVelden, snuffelType, type Uitgave } from './model';
import { bestandenVan, leveranciers, moetUitgave } from './repo';

// Bonnetjes en facturen automatisch uitlezen: bestanden uit Storage halen, Claude vragen
// (lib/uitgaven/claude.ts), normaliseren (lib/uitgaven/model.ts) en alleen de lege velden
// vullen. Wat de gebruiker al heeft ingevuld, wordt nooit overschreven.

/** Anthropic weigert afbeeldingen boven 5 MB (gemeten als base64). */
const MAX_BEELD_BASE64 = 5 * 1024 * 1024;
/** Ruim onder de requestlimiet van 32 MB. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Maximaal zoveel bestanden van één uitgave meesturen (bv. meerdere pagina's als foto). */
const MAX_BESTANDEN = 4;

function beeldBlok(type: string, inhoud: Buffer): ContentBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: type as 'image/jpeg' | 'image/png' | 'image/webp', data: inhoud.toString('base64') }
  };
}

/** Bouwt de berichtinhoud uit de bestanden; geeft ook de reden als niets bruikbaar was. */
async function inhoudVoor(bestanden: { storage_path: string; mime_type: string }[]): Promise<{ blokken: ContentBlockParam[]; reden: string }> {
  const blokken: ContentBlockParam[] = [];
  let reden = 'Er is geen bestand om uit te lezen.';
  for (const b of bestanden.slice(0, MAX_BESTANDEN)) {
    const inhoud = await download(b.storage_path);
    if (!inhoud) {
      reden = 'Het bestand kon niet worden geopend.';
      continue;
    }
    const type = snuffelType(inhoud.subarray(0, 16)) ?? b.mime_type;
    if (type === 'application/pdf') {
      if (inhoud.length > MAX_PDF_BYTES) {
        reden = 'Deze PDF is te groot om automatisch uit te lezen.';
        continue;
      }
      blokken.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: inhoud.toString('base64') } });
    } else if (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp') {
      if (Math.ceil(inhoud.length / 3) * 4 > MAX_BEELD_BASE64) {
        reden = 'Deze afbeelding is te groot om automatisch uit te lezen.';
        continue;
      }
      blokken.push(beeldBlok(type, inhoud));
    } else {
      reden = 'HEIC-foto’s kunnen niet automatisch worden uitgelezen. Vul de velden zelf in (of upload als JPEG).';
    }
  }
  return { blokken, reden };
}

/**
 * Leest de bestanden van een uitgave uit en vult de lege velden. Gooit nooit vanwege
 * Claude: een mislukking wordt ai_status 'mislukt' met een melding, zodat de gebruiker
 * gewoon zelf invult. Geeft de bijgewerkte uitgave terug.
 */
export async function leesUitgaveUit(sb: SupabaseClient, id: string, vandaag: string): Promise<Uitgave> {
  const { uitgave } = await moetUitgave(sb, id);
  let kolommen: Record<string, unknown>;

  if (!heeftApiKey()) {
    kolommen = {
      ai_status: 'mislukt',
      ai_message: 'Automatisch uitlezen staat uit (geen ANTHROPIC_API_KEY op de server). Vul de velden zelf in.'
    };
  } else {
    try {
      const [bestanden, bekend] = await Promise.all([bestandenVan(sb, id), leveranciers(sb)]);
      const { blokken, reden } = await inhoudVoor(bestanden);
      if (!blokken.length) {
        kolommen = { ai_status: 'mislukt', ai_message: reden };
      } else {
        const ruw = await vraagClaude(blokken, systeemPrompt(vandaag, bekend));
        const r = normaliseerUitgelezen(ruw, vandaag);
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
