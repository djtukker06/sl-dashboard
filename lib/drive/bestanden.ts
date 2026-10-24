import 'server-only';
import { DriveFout, MAP_MIME, MELDING, qZoeken, ROOT_NAAM, type DriveBestand } from './kern';
import type { Verbinding } from './koppeling';
import { BACKUP_MAP, backupIds, beschermdeMappen, binnen, klantMap, projectMap, type KlantInfo, type ProjectInfo } from './mappen';
import type { DriveItem, Kruimel, MapInhoud } from './types';

// Bladeren, zoeken en de koppeling met klanten/projecten voor de Drive-API.

export function naarItem(b: DriveBestand, door: string | null = null): DriveItem {
  const grootte = b.size !== undefined ? Number(b.size) : NaN;
  return {
    id: b.id,
    naam: b.name,
    mime: b.mimeType,
    map: b.mimeType === MAP_MIME,
    grootte: Number.isFinite(grootte) ? grootte : null,
    gewijzigd: b.modifiedTime ?? null,
    link: b.webViewLink ?? null,
    door
  };
}

/** Wie uploadde deze bestanden via het dashboard (drive_bestanden). */
export async function uploaders(v: Verbinding, ids: string[]): Promise<Map<string, string>> {
  const uit = new Map<string, string>();
  if (!ids.length) return uit;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await v.service
      .from('drive_bestanden')
      .select('drive_file_id, geupload_door')
      .in('drive_file_id', ids.slice(i, i + 200));
    if (error) break; // vóór 0024: gewoon zonder "door"
    for (const r of (data ?? []) as { drive_file_id: string; geupload_door: string | null }[]) {
      if (r.geupload_door) uit.set(r.drive_file_id, r.geupload_door);
    }
  }
  return uit;
}

async function metUploaders(v: Verbinding, lijst: DriveBestand[]): Promise<DriveItem[]> {
  const door = await uploaders(v, lijst.filter((b) => b.mimeType !== MAP_MIME).map((b) => b.id));
  return lijst.map((b) => naarItem(b, door.get(b.id) ?? null));
}

/** Broodkruimel van de root tot en met deze map. */
async function kruimels(v: Verbinding, map: DriveBestand): Promise<Kruimel[]> {
  const root: Kruimel = { id: v.rootId, naam: ROOT_NAAM };
  if (map.id === v.rootId) return [root];
  const pad: Kruimel[] = [{ id: map.id, naam: map.name }];
  let ouder = map.parents?.[0];
  for (let i = 0; i < 25 && ouder && ouder !== v.rootId; i++) {
    const o = await v.client.bestand(ouder, 'id,name,parents');
    pad.unshift({ id: o.id, naam: o.name });
    ouder = o.parents?.[0];
  }
  return [root, ...pad];
}

/** Inhoud van een map binnen de root (leeg id = de root zelf). */
export async function mapInhoud(v: Verbinding, mapId: string | null): Promise<MapInhoud> {
  const id = mapId || v.rootId;
  const map = id === v.rootId ? await v.client.bestand(v.rootId) : await binnen(v, id);
  if (map.mimeType !== MAP_MIME) throw new DriveFout('niet_gevonden', MELDING.niet_gevonden);
  const [alles, kruim, beschermd, verborgen] = await Promise.all([v.client.kinderen(map.id), kruimels(v, map), beschermdeMappen(v), backupIds(v)]);
  // De Back-ups-map is alleen voor de eigenaar (pagina Beveiliging), niet voor de Drive-module.
  const lijst = alles.filter((b) => !verborgen.has(b.id) && !(map.id === v.rootId && b.name === BACKUP_MAP && b.mimeType === MAP_MIME));
  return {
    map: { id: map.id, naam: map.id === v.rootId ? ROOT_NAAM : map.name },
    kruimels: kruim,
    items: await metUploaders(v, lijst),
    beschermd: [...beschermd],
    link: map.webViewLink ?? null
  };
}

/** Zoeken binnen de root: Drive zoekt overal, daarna houden we alleen wat binnen ligt. */
export async function zoek(v: Verbinding, q: string): Promise<DriveItem[]> {
  const kandidaten = await v.client.lijst(qZoeken(q), { max: 60 });
  const binnenRoot: DriveBestand[] = [];
  for (const b of kandidaten) {
    try {
      binnenRoot.push(await binnen(v, b.id));
    } catch (e) {
      if (!(e instanceof DriveFout && (e.code === 'buiten_root' || e.code === 'niet_gevonden'))) throw e;
    }
    if (binnenRoot.length >= 40) break;
  }
  return metUploaders(v, binnenRoot);
}

/** Klant (naam) via de service-role. */
export async function klantInfo(v: Verbinding, id: string): Promise<KlantInfo | null> {
  const { data } = await v.service.from('clients').select('id, company_name').eq('id', id).maybeSingle();
  return data ? { id: data.id as string, naam: (data.company_name as string) || '' } : null;
}

export async function projectInfo(v: Verbinding, id: string): Promise<ProjectInfo | null> {
  const { data } = await v.service.from('projects').select('id, naam, client_id').eq('id', id).maybeSingle();
  if (!data) return null;
  const klant = data.client_id ? await klantInfo(v, data.client_id as string) : null;
  return { id: data.id as string, naam: (data.naam as string) || '', klant };
}

/** Map-id voor een doel (map / klant / project); `maak` = aanmaken bij eerste gebruik. */
export async function doelMap(
  v: Verbinding,
  doel: { map?: unknown; klant?: unknown; project?: unknown },
  maak: boolean,
  isUuid: (x: unknown) => x is string
): Promise<{ mapId: string | null; klantId: string | null; projectId: string | null }> {
  if (doel.klant !== undefined && doel.klant !== null) {
    if (!isUuid(doel.klant)) throw new DriveFout('ongeldig', 'Ongeldige klant.');
    const k = await klantInfo(v, doel.klant);
    if (!k) throw new DriveFout('niet_gevonden', 'Deze klant bestaat niet (meer).');
    return { mapId: await klantMap(v, k, maak), klantId: k.id, projectId: null };
  }
  if (doel.project !== undefined && doel.project !== null) {
    if (!isUuid(doel.project)) throw new DriveFout('ongeldig', 'Ongeldig project.');
    const p = await projectInfo(v, doel.project);
    if (!p) throw new DriveFout('niet_gevonden', 'Dit project bestaat niet (meer).');
    return { mapId: await projectMap(v, p, maak), klantId: p.klant?.id ?? null, projectId: p.id };
  }
  if (typeof doel.map === 'string' && doel.map) {
    const b = doel.map === v.rootId ? await v.client.bestand(v.rootId) : await binnen(v, doel.map);
    if (b.mimeType !== MAP_MIME) throw new DriveFout('ongeldig', 'Dit is geen map.');
    return { mapId: b.id, klantId: null, projectId: null };
  }
  return { mapId: v.rootId, klantId: null, projectId: null };
}
