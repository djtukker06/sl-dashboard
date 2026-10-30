import 'server-only';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { binnenRoot, DriveFout, KLANTEN, MELDING, padSleutel, schoneNaam, ZONDER_KLANT, type DriveBestand } from './kern';
import type { Verbinding } from './koppeling';

/** Naam van de back-upmap onder de root (zelfde waarde als BACKUP_MAP in lib/backup/drive.ts). */
export const BACKUP_MAP = 'Back-ups';

// De mappenstructuur onder de rootmap "Studio Levant":
//   Boekhouding/Facturen/<jaar>, Boekhouding/Prijsopgaven/<jaar>, Boekhouding/Bonnetjes/<jaar>
//   Klanten/<klantnaam>/<projectnaam>   (project zonder klant: Klanten/Zonder klant/<project>)
//   Algemeen
// Map-id's staan in drive_mappen (per root), zodat de server niet steeds hoeft te zoeken.
// Een gecachete map die in Drive is weggegooid, wordt opnieuw gezocht of aangemaakt.
// Mappen worden altijd eerst op naam gezocht (ook een map die iemand zelf in Drive maakte,
// wordt dus gebruikt) en pas daarna aangemaakt.

type Soort = 'pad' | 'klant' | 'project';
interface CacheRij {
  drive_id: string;
  naam: string;
  ouder_id: string | null;
}

// Per serverproces: id's waarvan al vaststaat dat ze (nog) bestaan en binnen de root liggen.
const gecontroleerd = new Map<string, Set<string>>();
function bekendVoor(rootId: string): Set<string> {
  let s = gecontroleerd.get(rootId);
  if (!s) {
    s = new Set([rootId]);
    gecontroleerd.set(rootId, s);
  }
  return s;
}
// Lopende aanmaak per sleutel: twee gelijktijdige uploads maken geen dubbele map.
const lopend = new Map<string, Promise<string>>();

async function cacheLees(v: Verbinding, soort: Soort, sleutel: string): Promise<CacheRij | null> {
  const { data, error } = await v.service
    .from('drive_mappen')
    .select('drive_id, naam, ouder_id')
    .eq('root_id', v.rootId)
    .eq('soort', soort)
    .eq('sleutel', sleutel)
    .maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) throw new DriveFout('tabel_ontbreekt', MELDING.tabel_ontbreekt);
    throw error;
  }
  return (data as CacheRij | null) ?? null;
}

async function cacheSchrijf(v: Verbinding, soort: Soort, sleutel: string, rij: CacheRij): Promise<void> {
  const { error } = await v.service
    .from('drive_mappen')
    .upsert({ root_id: v.rootId, soort, sleutel, ...rij, updated_at: new Date().toISOString() }, { onConflict: 'root_id,soort,sleutel' });
  if (error) console.error('[drive] mappen-cache schrijven', error.code ?? '', error.message);
}

async function cacheWis(v: Verbinding, soort: Soort, sleutel: string): Promise<void> {
  await v.service.from('drive_mappen').delete().eq('root_id', v.rootId).eq('soort', soort).eq('sleutel', sleutel);
}

/** Bestaat deze gecachete map nog (niet in de prullenbak)? Eén keer per proces gecontroleerd. */
async function nogGeldig(v: Verbinding, id: string): Promise<DriveBestand | null> {
  const bekend = bekendVoor(v.rootId);
  try {
    const b = await v.client.bestand(id, 'id,name,parents,trashed');
    if (b.trashed) {
      bekend.delete(id);
      return null;
    }
    bekend.add(id);
    return b;
  } catch (e) {
    if (e instanceof DriveFout && e.code === 'niet_gevonden') {
      bekend.delete(id);
      return null;
    }
    throw e;
  }
}

async function eenmalig(sleutel: string, fn: () => Promise<string>): Promise<string> {
  const al = lopend.get(sleutel);
  if (al) return al;
  const p = fn().finally(() => lopend.delete(sleutel));
  lopend.set(sleutel, p);
  return p;
}

/** Het id van een pad onder de root (mappen worden zo nodig gezocht of aangemaakt). */
export async function zorgVoorPad(v: Verbinding, pad: string[]): Promise<string> {
  if (!pad.length) return v.rootId;
  const sleutel = padSleutel(pad);
  return eenmalig(`${v.rootId}|pad|${sleutel}`, async () => {
    const bekend = bekendVoor(v.rootId);
    const rij = await cacheLees(v, 'pad', sleutel);
    if (rij && (bekend.has(rij.drive_id) || (await nogGeldig(v, rij.drive_id)))) return rij.drive_id;
    if (rij) await cacheWis(v, 'pad', sleutel);
    const ouder = await zorgVoorPad(v, pad.slice(0, -1));
    const naam = pad[pad.length - 1];
    const map = await v.client.zorgVoorMap(ouder, naam);
    bekend.add(map.id);
    await cacheSchrijf(v, 'pad', sleutel, { drive_id: map.id, naam, ouder_id: ouder });
    return map.id;
  });
}

/** Zoekt een gecachete klant-/projectmap op en houdt naam en plek in Drive bij (best effort). */
async function bijgewerkt(v: Verbinding, soort: Soort, sleutel: string, rij: CacheRij, naam: string, ouder: string | null): Promise<string | null> {
  const b = bekendVoor(v.rootId).has(rij.drive_id) && rij.naam === naam && (!ouder || rij.ouder_id === ouder) ? ({ id: rij.drive_id } as DriveBestand) : await nogGeldig(v, rij.drive_id);
  if (!b) return null;
  const moetHernoemen = rij.naam !== naam;
  const moetVerplaatsen = Boolean(ouder && rij.ouder_id !== ouder);
  if (moetHernoemen || moetVerplaatsen) {
    try {
      await v.client.wijzig(
        rij.drive_id,
        moetHernoemen ? { name: naam } : {},
        moetVerplaatsen && ouder ? { naar: ouder, van: (b.parents ?? (rij.ouder_id ? [rij.ouder_id] : [])).filter((p) => p !== ouder) } : undefined
      );
      await cacheSchrijf(v, soort, sleutel, { drive_id: rij.drive_id, naam, ouder_id: ouder ?? rij.ouder_id });
    } catch (e) {
      console.warn('[drive] map bijwerken mislukt', (e as Error)?.message ?? e);
    }
  }
  return rij.drive_id;
}

export interface KlantInfo {
  id: string;
  naam: string;
}
export interface ProjectInfo {
  id: string;
  naam: string;
  klant: KlantInfo | null;
}

/**
 * De map van een klant (Klanten/<naam>). `maak` = aanmaken als hij er nog niet is; anders
 * alleen een bestaande (gecachet, of een map met die naam die er al staat) of null.
 */
export async function klantMap(v: Verbinding, klant: KlantInfo, maak: boolean): Promise<string | null> {
  const naam = schoneNaam(klant.naam, 'Naamloze klant');
  const doe = async (): Promise<string | null> => {
    const rij = await cacheLees(v, 'klant', klant.id);
    if (rij) {
      const id = await bijgewerkt(v, 'klant', klant.id, rij, naam, null);
      if (id) return id;
      await cacheWis(v, 'klant', klant.id);
    }
    let ouder: string | null;
    if (maak) ouder = await zorgVoorPad(v, [KLANTEN]);
    else {
      const k = await cacheLees(v, 'pad', KLANTEN);
      ouder = k?.drive_id ?? null;
    }
    if (!ouder) return null;
    const map = maak ? await v.client.zorgVoorMap(ouder, naam) : await v.client.zoekMap(ouder, naam);
    if (!map) return null;
    bekendVoor(v.rootId).add(map.id);
    await cacheSchrijf(v, 'klant', klant.id, { drive_id: map.id, naam, ouder_id: ouder });
    return map.id;
  };
  if (!maak) return doe();
  return eenmalig(`${v.rootId}|klant|${klant.id}`, async () => (await doe()) as string);
}

/** De map van een project (Klanten/<klant>/<project>); zie klantMap voor `maak`. */
export async function projectMap(v: Verbinding, project: ProjectInfo, maak: boolean): Promise<string | null> {
  const naam = schoneNaam(project.naam, 'Naamloos project');
  const doe = async (): Promise<string | null> => {
    const ouder = project.klant
      ? await klantMap(v, project.klant, maak)
      : maak
        ? await zorgVoorPad(v, [KLANTEN, ZONDER_KLANT])
        : ((await cacheLees(v, 'pad', padSleutel([KLANTEN, ZONDER_KLANT])))?.drive_id ?? null);
    const rij = await cacheLees(v, 'project', project.id);
    if (rij) {
      const id = await bijgewerkt(v, 'project', project.id, rij, naam, ouder);
      if (id) return id;
      await cacheWis(v, 'project', project.id);
    }
    if (!ouder) return null;
    const map = maak ? await v.client.zorgVoorMap(ouder, naam) : await v.client.zoekMap(ouder, naam);
    if (!map) return null;
    bekendVoor(v.rootId).add(map.id);
    await cacheSchrijf(v, 'project', project.id, { drive_id: map.id, naam, ouder_id: ouder });
    return map.id;
  };
  if (!maak) return doe();
  return eenmalig(`${v.rootId}|project|${project.id}`, async () => (await doe()) as string);
}

/** Hernoemt de klantmap na het hernoemen van de klant (best effort; alleen als hij al bestaat). */
export async function hernoemKlantMap(v: Verbinding, klant: KlantInfo): Promise<void> {
  if (await cacheLees(v, 'klant', klant.id)) await klantMap(v, klant, false);
}

/** Hernoemt/verplaatst de projectmap na een wijziging van het project (best effort). */
export async function werkProjectMapBij(v: Verbinding, project: ProjectInfo): Promise<void> {
  if (await cacheLees(v, 'project', project.id)) await projectMap(v, project, false);
}

/** De vaste mappen (root en alle gecachete paden): niet te hernoemen of te verwijderen. */
export async function beschermdeMappen(v: Verbinding): Promise<Set<string>> {
  const { data } = await v.service.from('drive_mappen').select('drive_id').eq('root_id', v.rootId).eq('soort', 'pad');
  return new Set([v.rootId, ...((data ?? []) as { drive_id: string }[]).map((r) => r.drive_id)]);
}

/**
 * Het bestand als het binnen de root ligt, anders DriveFout 'buiten_root'. Gecachete
 * mappen (drive_mappen) en eerder gecontroleerde mappen tellen als "binnen".
 */
export async function binnen(v: Verbinding, id: string): Promise<DriveBestand> {
  const bekend = bekendVoor(v.rootId);
  if (bekend.size < 50) {
    const { data } = await v.service.from('drive_mappen').select('drive_id').eq('root_id', v.rootId).limit(500);
    for (const r of (data ?? []) as { drive_id: string }[]) bekend.add(r.drive_id);
  }
  const b = await binnenRoot(v.client, v.rootId, id, bekend);
  if (!b) throw new DriveFout('buiten_root', MELDING.buiten_root);
  if (b.mimeType === 'application/vnd.google-apps.folder') bekend.add(b.id);
  return b;
}

/** Na ontkoppelen of opnieuw koppelen: vergeet wat dit proces wist. */
export function vergeetMappen(): void {
  gecontroleerd.clear();
  lopend.clear();
}
