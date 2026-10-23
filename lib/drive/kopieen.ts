import 'server-only';
import { after } from 'next/server';
import type { Teamlid, TeamlidBewijs } from '@/lib/auth/team';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { veiligeBestandsnaam } from '@/lib/invoice/bestandsnaam';
import { ontbrekendeEnv } from './config';
import { bonnetjeNaam, boekhoudPad, dagVan, DriveFout, jaarVan, MELDING, type KopieSoort } from './kern';
import { verbind, type Verbinding } from './koppeling';
import { zorgVoorPad } from './mappen';

// Kopieën naar Boekhouding/Facturen|Prijsopgaven|Bonnetjes/<jaar> in Drive.
//
// - Na het aanmaken/bijwerken van een factuur, prijsopgave of bonnetje roept de route
//   naDrive() aan: dat plant de kopie met next/server `after`, dus NA het antwoord. De
//   factuurflow wacht er nooit op en kan er nooit door mislukken (alles in try/catch); is
//   Drive niet gekoppeld of onbereikbaar, dan gebeurt er gewoon niets.
// - drive_kopieen houdt per bron bij welk Storage-pad gekopieerd is. Zelfde pad = niets te
//   doen; ander pad (factuur bewerkt → nieuwe PDF) = de inhoud van hetzelfde Drive-bestand
//   wordt vervangen (geen dubbele bestanden).
// - kopieerBestaande() doet hetzelfde voor alles wat er al was (knop voor de eigenaar),
//   in porties binnen een tijdslimiet; opnieuw draaien slaat het gekopieerde over.

interface Bron {
  pad: string;
  bucket: string;
  naam: string;
  mime: string;
  jaar: string;
}

async function leesBron(v: Verbinding, soort: KopieSoort, id: string): Promise<Bron | null> {
  if (soort === 'factuur') {
    const { data } = await v.service.from('invoices').select('*').eq('id', id).maybeSingle();
    if (!data?.pdf_path) return null;
    return {
      pad: data.pdf_path,
      bucket: 'invoices',
      // Dezelfde naam als de download (app/api/invoices/[id]/pdf).
      naam: veiligeBestandsnaam(data.name || '', `Factuur ${data.invoice_number}`),
      mime: 'application/pdf',
      jaar: jaarVan(data.issued_at)
    };
  }
  if (soort === 'prijsopgave') {
    const { data } = await v.service.from('quotes').select('*').eq('id', id).maybeSingle();
    if (!data?.pdf_path) return null;
    return {
      pad: data.pdf_path,
      bucket: 'invoices',
      naam: veiligeBestandsnaam(data.name || '', 'Prijsopgave'),
      mime: 'application/pdf',
      jaar: jaarVan(data.issued_at)
    };
  }
  const { data } = await v.service
    .from('expense_files')
    .select('storage_path, file_name, mime_type, created_at, expenses(expense_date)')
    .eq('id', id)
    .maybeSingle();
  if (!data?.storage_path) return null;
  const uitgave = (Array.isArray(data.expenses) ? data.expenses[0] : data.expenses) as { expense_date?: string | null } | null;
  const datum = uitgave?.expense_date || data.created_at;
  return {
    pad: data.storage_path,
    bucket: 'uitgaven',
    naam: bonnetjeNaam(dagVan(datum), data.file_name || data.storage_path.split('/').pop() || 'bonnetje'),
    mime: data.mime_type || 'application/octet-stream',
    jaar: jaarVan(datum)
  };
}

export type KopieUitkomst = 'gekopieerd' | 'bijgewerkt' | 'overgeslagen' | 'geen_bestand';

async function kopieer(v: Verbinding, soort: KopieSoort, id: string, controleer: boolean): Promise<KopieUitkomst> {
  const bron = await leesBron(v, soort, id);
  if (!bron) return 'geen_bestand';

  const { data: bestaand, error } = await v.service
    .from('drive_kopieen')
    .select('bron_pad, drive_file_id')
    .eq('root_id', v.rootId)
    .eq('bron', soort)
    .eq('bron_id', id)
    .maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) throw new DriveFout('tabel_ontbreekt', MELDING.tabel_ontbreekt);
    throw error;
  }

  let driveId: string | null = (bestaand?.drive_file_id as string | undefined) ?? null;
  if (driveId && controleer) {
    // Nog in Drive (niet weggegooid)? Anders opnieuw kopiëren.
    try {
      const b = await v.client.bestand(driveId, 'id,trashed');
      if (b.trashed) driveId = null;
    } catch (e) {
      if (e instanceof DriveFout && e.code === 'niet_gevonden') driveId = null;
      else throw e;
    }
  }
  if (driveId && bestaand?.bron_pad === bron.pad) return 'overgeslagen';

  const { data: blob, error: dlFout } = await v.service.storage.from(bron.bucket).download(bron.pad);
  if (dlFout || !blob) throw new Error(`Bestand niet op te halen uit Storage (${soort})`);
  const inhoud = new Uint8Array(await blob.arrayBuffer());

  let resultaat: KopieUitkomst = 'gekopieerd';
  let nieuwId: string;
  if (driveId) {
    try {
      nieuwId = (await v.client.upload({ id: driveId, naam: bron.naam, mime: bron.mime, inhoud })).id;
      resultaat = 'bijgewerkt';
    } catch (e) {
      if (!(e instanceof DriveFout && e.code === 'niet_gevonden')) throw e;
      const ouder = await zorgVoorPad(v, boekhoudPad(soort, bron.jaar));
      nieuwId = (await v.client.upload({ ouderId: ouder, naam: bron.naam, mime: bron.mime, inhoud })).id;
    }
  } else {
    const ouder = await zorgVoorPad(v, boekhoudPad(soort, bron.jaar));
    nieuwId = (await v.client.upload({ ouderId: ouder, naam: bron.naam, mime: bron.mime, inhoud })).id;
  }

  const { error: schrijfFout } = await v.service.from('drive_kopieen').upsert(
    { root_id: v.rootId, bron: soort, bron_id: id, bron_pad: bron.pad, drive_file_id: nieuwId, gekopieerd_op: new Date().toISOString() },
    { onConflict: 'root_id,bron,bron_id' }
  );
  if (schrijfFout) console.error('[drive] kopie vastleggen', schrijfFout.code ?? '', schrijfFout.message);
  return resultaat;
}

/** Kopieer één factuur/prijsopgave/bonnetje-bestand naar Drive (gooit bij fouten). */
export async function kopieerNaarDrive(bewijs: TeamlidBewijs, soort: KopieSoort, id: string): Promise<KopieUitkomst> {
  const v = await verbind(bewijs);
  return kopieer(v, soort, id, true);
}

const STIL = new Set(['niet_ingericht', 'niet_gekoppeld', 'tabel_ontbreekt']);

/**
 * Plan een kopie naar Drive ná het antwoord (next/server `after`). Gooit nooit en wacht
 * nergens op: de aanroepende route (facturen, bonnetjes) merkt er niets van.
 */
export function naDrive(lid: Teamlid, soort: KopieSoort, id: string | null | undefined): void {
  try {
    if (!id || lid.overgang || ontbrekendeEnv().length) return;
    const bewijs = lid.bewijs;
    after(async () => {
      try {
        await kopieerNaarDrive(bewijs, soort, id);
      } catch (e) {
        if (e instanceof DriveFout && STIL.has(e.code)) return;
        console.warn(`[drive] kopie ${soort} ${id} mislukt:`, (e as Error)?.message ?? e);
      }
    });
  } catch (e) {
    console.warn('[drive] kopie plannen mislukt:', (e as Error)?.message ?? e);
  }
}

/** Plan iets anders na het antwoord (best effort, zelfde garanties als naDrive). */
export function naAntwoord(label: string, fn: () => Promise<unknown>): void {
  try {
    if (ontbrekendeEnv().length) return;
    after(async () => {
      try {
        await fn();
      } catch (e) {
        if (e instanceof DriveFout && STIL.has(e.code)) return;
        console.warn(`[drive] ${label} mislukt:`, (e as Error)?.message ?? e);
      }
    });
  } catch {
    /* best effort */
  }
}

export interface BulkUitkomst {
  gekopieerd: number;
  overgeslagen: number;
  mislukt: number;
  resterend: number;
  klaar: boolean;
}

/**
 * Bestaande facturen, prijsopgaven en bonnetjes naar Drive (idempotent). Werkt tot de
 * tijdslimiet en meldt hoeveel er nog over is; de knop roept het dan opnieuw aan.
 */
export async function kopieerBestaande(bewijs: TeamlidBewijs, tijdslimietMs = 40_000): Promise<BulkUitkomst> {
  const start = Date.now();
  const v = await verbind(bewijs);

  const [fac, prijs, bon, kop] = await Promise.all([
    v.service.from('invoices').select('id, pdf_path').not('pdf_path', 'is', null).limit(5000),
    v.service.from('quotes').select('id, pdf_path').not('pdf_path', 'is', null).limit(5000),
    v.service.from('expense_files').select('id, storage_path').limit(10000),
    v.service.from('drive_kopieen').select('bron, bron_id, bron_pad').eq('root_id', v.rootId).limit(20000)
  ]);
  if (kop.error && tabelOntbreekt(kop.error)) throw new DriveFout('tabel_ontbreekt', MELDING.tabel_ontbreekt);

  const gedaan = new Map<string, string>();
  for (const r of (kop.data ?? []) as { bron: string; bron_id: string; bron_pad: string }[]) gedaan.set(`${r.bron}:${r.bron_id}`, r.bron_pad);

  const alles: { soort: KopieSoort; id: string; pad: string }[] = [
    ...((fac.data ?? []) as { id: string; pdf_path: string }[]).map((r) => ({ soort: 'factuur' as const, id: r.id, pad: r.pdf_path })),
    ...((prijs.data ?? []) as { id: string; pdf_path: string }[]).map((r) => ({ soort: 'prijsopgave' as const, id: r.id, pad: r.pdf_path })),
    // Uitgaven bestaan pas na 0020; zonder tabel gewoon geen bonnetjes.
    ...((bon.error ? [] : bon.data ?? []) as { id: string; storage_path: string }[]).map((r) => ({ soort: 'bonnetje' as const, id: r.id, pad: r.storage_path }))
  ];
  const te = alles.filter((x) => gedaan.get(`${x.soort}:${x.id}`) !== x.pad);
  const uit: BulkUitkomst = { gekopieerd: 0, overgeslagen: alles.length - te.length, mislukt: 0, resterend: te.length, klaar: false };

  for (const x of te) {
    if (Date.now() - start > tijdslimietMs) break;
    try {
      const r = await kopieer(v, x.soort, x.id, false);
      if (r === 'overgeslagen' || r === 'geen_bestand') uit.overgeslagen++;
      else uit.gekopieerd++;
    } catch (e) {
      // Koppeling weg of opslag vol: stoppen in plaats van elk bestand te laten mislukken.
      if (e instanceof DriveFout && (e.code === 'opnieuw_koppelen' || e.code === 'vol' || e.code === 'tabel_ontbreekt')) throw e;
      uit.mislukt++;
      console.warn(`[drive] bestaande ${x.soort} ${x.id} kopiëren mislukt:`, (e as Error)?.message ?? e);
    }
    uit.resterend--;
  }
  // klaar = alles is geprobeerd (mislukte komen bij een volgende klik opnieuw aan de beurt).
  uit.klaar = uit.resterend === 0;
  return uit;
}
