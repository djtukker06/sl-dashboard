import type { SupabaseClient } from '@supabase/supabase-js';
import { zipBuffer, type ZipEntry } from '@/lib/social/zip';
import { dbFout } from './api';
import { download, exportKlaarzetten } from './opslag';
import { exportBestandsnaam, maakCsv, type Uitgave } from './model';

// Export voor de boekhouder: CSV (puntkomma, NL-decimalen) en een ZIP met alle bonnetjes
// (JJJJ-MM-DD_leverancier_bedrag.ext) plus die CSV. Een Vercel-respons mag max. 4,5 MB
// zijn, dus de ZIP gaat via Storage (bucket uitgaven-export) en een signed URL, net als de
// social-export. Grote periodes worden in delen van max. ±45 MB gesplitst (de bucket
// staat 50 MB per bestand toe); elk deel bevat de volledige CSV.

const MAX_DEEL_BYTES = 45 * 1024 * 1024;

/** Unieke exportnamen per bestand (zelfde datum/leverancier/bedrag krijgt -2, -3 …). */
export async function exportNamen(
  sb: SupabaseClient,
  uitgaven: Uitgave[]
): Promise<{ namen: Map<string, string[]>; bestanden: { uitgaveId: string; pad: string; naam: string }[] }> {
  const ids = uitgaven.filter((u) => u.bestanden.length).map((u) => u.id);
  const paden = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('expense_files').select('id,storage_path').in('expense_id', ids.slice(i, i + 200));
    if (error) throw dbFout(error);
    for (const r of (data ?? []) as { id: string; storage_path: string }[]) paden.set(r.id, r.storage_path);
  }
  const gebruikt = new Set<string>();
  const namen = new Map<string, string[]>();
  const bestanden: { uitgaveId: string; pad: string; naam: string }[] = [];
  for (const u of uitgaven) {
    const lijst: string[] = [];
    u.bestanden.forEach((b, i) => {
      const pad = paden.get(b.id);
      if (!pad) return;
      let naam = exportBestandsnaam(u, b.type, i + 1);
      for (let n = 2; gebruikt.has(naam); n++) naam = naam.replace(/(\.[a-z]+)$/, `_${n}$1`);
      gebruikt.add(naam);
      lijst.push(naam);
      bestanden.push({ uitgaveId: u.id, pad, naam });
    });
    namen.set(u.id, lijst);
  }
  return { namen, bestanden };
}

/** Maakt de ZIP('s) en geeft per deel een naam en signed download-URL terug. */
export async function maakZipExport(
  sb: SupabaseClient,
  uitgaven: Uitgave[],
  basisNaam: string
): Promise<{ naam: string; url: string; aantal: number }[]> {
  const { namen, bestanden } = await exportNamen(sb, uitgaven);
  const csv = maakCsv(uitgaven, namen);

  // Bestanden ophalen (een paar tegelijk); zodra een deel vol is, gaat het als ZIP naar
  // Storage en uit het geheugen.
  const uit: { naam: string; url: string; aantal: number }[] = [];
  const ontbrekend: string[] = [];
  let deel: ZipEntry[] = [];
  let grootte = 0;
  async function zetKlaar(laatste: boolean) {
    const entries: ZipEntry[] = [{ name: `${basisNaam}.csv`, data: csv }, ...deel];
    if (laatste && ontbrekend.length) {
      entries.push({
        name: 'LEESMIJ-ontbrekende-bestanden.txt',
        data: `Deze bestanden konden niet worden opgehaald:\r\n${ontbrekend.join('\r\n')}\r\n`
      });
    }
    // Meer dan één deel: het eerste heet dan ook "-deel-1".
    const nummer = uit.length + 1;
    const naam = !laatste || nummer > 1 ? `${basisNaam}-deel-${nummer}.zip` : `${basisNaam}.zip`;
    const url = await exportKlaarzetten(naam, await zipBuffer(entries));
    uit.push({ naam, url, aantal: deel.length });
    deel = [];
    grootte = 0;
  }
  for (let i = 0; i < bestanden.length; i += 6) {
    const groep = bestanden.slice(i, i + 6);
    const inhoud = await Promise.all(groep.map((b) => download(b.pad)));
    for (let j = 0; j < groep.length; j++) {
      const data = inhoud[j];
      if (!data) {
        ontbrekend.push(groep[j].naam);
        continue;
      }
      if (grootte + data.length > MAX_DEEL_BYTES && deel.length) await zetKlaar(false);
      deel.push({ name: `bonnetjes/${groep[j].naam}`, data });
      grootte += data.length;
    }
  }
  await zetKlaar(true);
  return uit;
}
