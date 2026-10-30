import 'server-only';
import { after } from 'next/server';
import type { Teamlid, TeamlidBewijs } from '@/lib/auth/team';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { veiligeBestandsnaam } from '@/lib/invoice/bestandsnaam';
import { exportBestandsnaam, isDatum } from '@/lib/uitgaven/model';
import { ontbrekendeEnv } from './config';
import { bonnetjeNaam, boekhoudPad, dagVan, DriveFout, foutTekst, jaarVan, MELDING, metNummer, type KopieSoort } from './kern';
import { verbind, type Verbinding } from './koppeling';
import { zorgVoorPad } from './mappen';

// Kopieën naar Boekhouding/Factuur en Boekhouding/Prijsopgaven|Bonnetjes/<jaar> in Drive.
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
// - Logs: elke regel begint met "[drive]" (zoeken in de Vercel-logs). Per kopie een
//   start- en een eindregel; een startregel zonder eindregel = de functie is gestopt
//   (maxDuration van de route, 60 s voor facturen) voordat de kopie klaar was.

/** Na zoveel ms een waarschuwing in de logs als de kopie nog loopt (routes hebben maxDuration 60). */
const TRAAG_MS = 40_000;

/**
 * Bestandsnaam voor een factuur/prijsopgave in Drive: dezelfde (veilige) naam als de
 * download, met het nummer ervoor als het er nog niet in staat (zie metNummer in kern.ts).
 */
export function documentNaam(naam: string | null | undefined, nummer: string | null | undefined, terugval: string): string {
  const n = (nummer || '').trim();
  return metNummer(veiligeBestandsnaam(naam || '', n ? `${terugval} ${n}` : terugval), n);
}

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
      // De naam van de download (app/api/invoices/[id]/pdf), met het factuurnummer erbij.
      naam: documentNaam(data.name, data.invoice_number, 'Factuur'),
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
      naam: documentNaam(data.name, data.quote_number, 'Prijsopgave'),
      mime: 'application/pdf',
      jaar: jaarVan(data.issued_at)
    };
  }
  const { data } = await v.service
    .from('expense_files')
    .select('expense_id, storage_path, file_name, mime_type, created_at, expenses(expense_date, supplier, total_amount)')
    .eq('id', id)
    .maybeSingle();
  if (!data?.storage_path) return null;
  const uitgave = (Array.isArray(data.expenses) ? data.expenses[0] : data.expenses) as {
    expense_date?: string | null;
    supplier?: string | null;
    total_amount?: number | string | null;
  } | null;
  const mime = data.mime_type || 'application/octet-stream';
  // Datum bekend (uitgelezen of zelf ingevuld): JJJJ-MM-DD_leverancier_bedrag.ext, net als de
  // export voor de boekhouder, in de map van dat jaar. Nog geen datum: de uploaddatum en de
  // bestandsnaam; zodra de gegevens er zijn, hernoemt/verplaatst kopieer() het bestand.
  if (uitgave?.expense_date && isDatum(uitgave.expense_date)) {
    const { data: broers } = await v.service.from('expense_files').select('id').eq('expense_id', data.expense_id).order('created_at');
    const volgnummer = Math.max(1, ((broers ?? []) as { id: string }[]).findIndex((b) => b.id === id) + 1);
    const totaal = uitgave.total_amount === null || uitgave.total_amount === undefined ? null : Number(uitgave.total_amount);
    return {
      pad: data.storage_path,
      bucket: 'uitgaven',
      naam: exportBestandsnaam(
        { datum: uitgave.expense_date, leverancier: uitgave.supplier || '', totaal: Number.isFinite(totaal) ? totaal : null },
        mime,
        volgnummer
      ),
      mime,
      jaar: jaarVan(uitgave.expense_date)
    };
  }
  return {
    pad: data.storage_path,
    bucket: 'uitgaven',
    naam: bonnetjeNaam(dagVan(data.created_at), data.file_name || data.storage_path.split('/').pop() || 'bonnetje'),
    mime,
    jaar: jaarVan(data.created_at)
  };
}

export type KopieUitkomst = 'gekopieerd' | 'bijgewerkt' | 'hernoemd' | 'overgeslagen' | 'geen_bestand';
export interface KopieResultaat {
  uitkomst: KopieUitkomst;
  /** Map in Drive, bv. "Boekhouding/Factuur" of "Boekhouding/Bonnetjes/2026". */
  map?: string;
  naam?: string;
}

async function kopieer(v: Verbinding, soort: KopieSoort, id: string, controleer: boolean): Promise<KopieResultaat> {
  const bron = await leesBron(v, soort, id);
  if (!bron) return { uitkomst: 'geen_bestand' };
  const map = boekhoudPad(soort, bron.jaar).join('/');
  const r = (uitkomst: KopieUitkomst): KopieResultaat => ({ uitkomst, map, naam: bron.naam });

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
  let inDrive: { name?: string; parents?: string[] } | null = null;
  if (driveId && controleer) {
    // Nog in Drive (niet weggegooid)? Anders opnieuw kopiëren.
    try {
      const b = await v.client.bestand(driveId, 'id,name,parents,trashed');
      if (b.trashed) driveId = null;
      else inDrive = b;
    } catch (e) {
      if (e instanceof DriveFout && e.code === 'niet_gevonden') driveId = null;
      else throw e;
    }
  }
  if (driveId && bestaand?.bron_pad === bron.pad) {
    // Bonnetjes: zelfde bestand, maar misschien nu met datum/leverancier/bedrag → hernoemen
    // en zo nodig naar de map van het juiste jaar verplaatsen (facturen: ongewijzigd).
    if (soort !== 'bonnetje' || !inDrive) return r('overgeslagen');
    const ouder = await zorgVoorPad(v, boekhoudPad(soort, bron.jaar));
    const ouders = inDrive.parents ?? [];
    const juisteMap = ouders.includes(ouder);
    if (inDrive.name === bron.naam && juisteMap) return r('overgeslagen');
    await v.client.wijzig(driveId, { name: bron.naam }, juisteMap ? undefined : { naar: ouder, van: ouders });
    return r('hernoemd');
  }

  const { data: blob, error: dlFout } = await v.service.storage.from(bron.bucket).download(bron.pad);
  if (dlFout || !blob) throw new Error(`Bestand niet op te halen uit Storage (${bron.bucket}/${bron.pad}): ${dlFout?.message ?? 'leeg'}`);
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
  return r(resultaat);
}

/** Kopieer één factuur/prijsopgave/bonnetje-bestand naar Drive (gooit bij fouten). */
export async function kopieerNaarDrive(bewijs: TeamlidBewijs, soort: KopieSoort, id: string): Promise<KopieResultaat> {
  const v = await verbind(bewijs);
  return kopieer(v, soort, id, true);
}

/** Geen fout maar een toestand (niet ingericht/gekoppeld): één korte info-regel. */
const STIL = new Set(['niet_ingericht', 'niet_gekoppeld', 'tabel_ontbreekt']);

/**
 * Voert een Drive-taak uit binnen after(), met logregels die in Vercel te vinden zijn:
 * "[drive] <label>: gestart", daarna "klaar …", "overgeslagen …" of "MISLUKT …", en een
 * waarschuwing als het na TRAAG_MS nog loopt. Gooit nooit.
 */
export async function metDriveLog<T>(label: string, fn: () => Promise<T>, klaar: (r: T) => string = () => 'klaar'): Promise<void> {
  const start = Date.now();
  const traag = setTimeout(() => {
    console.warn(`[drive] ${label}: na ${Math.round(TRAAG_MS / 1000)} s nog niet klaar (de route stopt na maxDuration; dan ontbreekt de kopie)`);
  }, TRAAG_MS);
  console.info(`[drive] ${label}: gestart`);
  try {
    const r = await fn();
    console.info(`[drive] ${label}: ${klaar(r)} (${((Date.now() - start) / 1000).toFixed(1)} s)`);
  } catch (e) {
    if (e instanceof DriveFout && STIL.has(e.code)) {
      console.info(`[drive] ${label}: overgeslagen, ${foutTekst(e)}`);
    } else {
      console.error(`[drive] ${label}: MISLUKT na ${((Date.now() - start) / 1000).toFixed(1)} s, ${foutTekst(e)}`);
    }
  } finally {
    clearTimeout(traag);
  }
}

function plan(label: string, taak: () => Promise<void>): void {
  try {
    after(taak);
  } catch (e) {
    // after() buiten een verzoek (zou niet moeten): dan in elk geval in de logs.
    console.error(`[drive] ${label}: plannen mislukt, ${foutTekst(e)}`);
  }
}

/**
 * Plan een kopie naar Drive ná het antwoord (next/server `after`). Gooit nooit en wacht
 * nergens op: de aanroepende route (facturen, bonnetjes) merkt er niets van.
 */
export function naDrive(lid: Teamlid, soort: KopieSoort, id: string | null | undefined): void {
  try {
    const label = `kopie ${soort} ${id ?? '?'}`;
    if (!id || lid.overgang) return;
    const ontbreekt = ontbrekendeEnv();
    if (ontbreekt.length) {
      console.info(`[drive] ${label}: overgeslagen, env ontbreekt (${ontbreekt.join(', ')})`);
      return;
    }
    const bewijs = lid.bewijs;
    plan(label, () =>
      metDriveLog(
        label,
        () => kopieerNaarDrive(bewijs, soort, id),
        (r) => (r.uitkomst === 'geen_bestand' ? 'geen PDF/bestand gevonden, niets gekopieerd' : `${r.uitkomst} → ${r.map}/${r.naam}`)
      )
    );
  } catch (e) {
    console.error(`[drive] kopie ${soort} ${id ?? '?'}: plannen mislukt, ${foutTekst(e)}`);
  }
}

/**
 * Alle bestanden van een uitgave (bonnetje) naar Drive, ná het antwoord: aangeroepen nadat het
 * uitlezen klaar is en na het (handmatig) wijzigen van datum, leverancier of bedrag. Nieuwe
 * bestanden worden gekopieerd als JJJJ-MM-DD_leverancier_bedrag.ext; bestaande kopieën
 * hernoemd en zo nodig naar de juiste jaarmap verplaatst. Gooit nooit, wacht nergens op.
 */
export function naDriveUitgave(lid: Teamlid, uitgaveId: string | null | undefined): void {
  const label = `kopie bonnetje(s) van uitgave ${uitgaveId ?? '?'}`;
  try {
    if (!uitgaveId || lid.overgang) return;
    const ontbreekt = ontbrekendeEnv();
    if (ontbreekt.length) {
      console.info(`[drive] ${label}: overgeslagen, env ontbreekt (${ontbreekt.join(', ')})`);
      return;
    }
    const bewijs = lid.bewijs;
    plan(label, () =>
      metDriveLog(
        label,
        async () => {
          const v = await verbind(bewijs);
          const { data, error } = await v.service.from('expense_files').select('id').eq('expense_id', uitgaveId).order('created_at');
          if (error) throw error;
          const uit: KopieResultaat[] = [];
          for (const b of (data ?? []) as { id: string }[]) uit.push(await kopieer(v, 'bonnetje', b.id, true));
          return uit;
        },
        (r) => (r.length ? r.map((x) => (x.uitkomst === 'geen_bestand' ? 'geen bestand' : `${x.uitkomst} → ${x.map}/${x.naam}`)).join('; ') : 'geen bestanden')
      )
    );
  } catch (e) {
    console.error(`[drive] ${label}: plannen mislukt, ${foutTekst(e)}`);
  }
}

/** Plan iets anders na het antwoord (best effort, zelfde garanties en logs als naDrive). */
export function naAntwoord(label: string, fn: () => Promise<unknown>): void {
  if (ontbrekendeEnv().length) return;
  plan(label, () => metDriveLog(label, fn));
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
      const { uitkomst: r } = await kopieer(v, x.soort, x.id, false);
      if (r === 'overgeslagen' || r === 'geen_bestand') uit.overgeslagen++;
      else uit.gekopieerd++;
    } catch (e) {
      // Koppeling weg of opslag vol: stoppen in plaats van elk bestand te laten mislukken.
      if (e instanceof DriveFout && (e.code === 'opnieuw_koppelen' || e.code === 'vol' || e.code === 'tabel_ontbreekt')) throw e;
      uit.mislukt++;
      console.error(`[drive] bestaande ${x.soort} ${x.id} kopiëren MISLUKT, ${foutTekst(e)}`);
    }
    uit.resterend--;
  }
  // klaar = alles is geprobeerd (mislukte komen bij een volgende klik opnieuw aan de beurt).
  uit.klaar = uit.resterend === 0;
  return uit;
}
