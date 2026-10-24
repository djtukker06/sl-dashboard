import 'server-only';
import { DriveFout, MAP_MIME, qKinderen, qTekst, type DriveBestand } from '@/lib/drive/kern';
import { BACKUP_MAP, zorgVoorPad } from '@/lib/drive/mappen';
import type { Verbinding } from '@/lib/drive/koppeling';
import { EXTENSIE_DB } from './formaat-kern';
import { teVerwijderen } from './retentie-kern';

// De back-ups in Google Drive, onder de rootmap "Studio Levant":
//   Back-ups/<jaar>/<YYYY-MM-DD>.slbak                 dagelijkse database-back-up
//   Back-ups/<jaar>/<datum>-handmatig-<HHmm>.slbak     "Nu back-up maken"
//   Back-ups/Bestanden/<bucket>/<pad met __>.slenc     storage-bestanden (wekelijks, incrementeel)
// Alles is versleuteld (lib/backup/formaat-kern.ts); Drive ziet alleen onleesbare bytes.

export { BACKUP_MAP };
export const BESTANDEN_MAP = 'Bestanden';
const MIME = 'application/octet-stream';

async function zoekOpNaam(v: Verbinding, ouderId: string, naam: string): Promise<DriveBestand[]> {
  return v.client.lijst(`${qKinderen(ouderId)} and name = ${qTekst(naam)}`, { max: 10 });
}

/**
 * Zet een database-back-up in Drive: eerst als "<naam>.tmp", na een geslaagde upload
 * hernoemen. Een oudere back-up met dezelfde naam (zelfde dag) gaat daarna naar de prullenbak.
 */
export async function uploadDbBackup(v: Verbinding, naam: string, inhoud: Uint8Array): Promise<DriveBestand> {
  const jaar = naam.slice(0, 4);
  const ouder = await zorgVoorPad(v, [BACKUP_MAP, jaar]);
  const oud = await zoekOpNaam(v, ouder, naam);
  const tmp = await v.client.upload({ naam: `${naam}.tmp`, mime: MIME, inhoud, ouderId: ouder });
  const b = await v.client.wijzig(tmp.id, { name: naam });
  for (const o of oud) {
    if (o.id !== b.id) await v.client.wijzig(o.id, { trashed: true }).catch(() => undefined);
  }
  return b;
}

/** Alle database-back-ups in Drive (alle jaarmappen). */
export async function lijstDbBackups(v: Verbinding): Promise<DriveBestand[]> {
  const root = await zorgVoorPad(v, [BACKUP_MAP]);
  const jaren = (await v.client.kinderen(root, 200)).filter((m) => m.mimeType === MAP_MIME && /^\d{4}$/.test(m.name));
  const uit: DriveBestand[] = [];
  for (const j of jaren) {
    const files = await v.client.kinderen(j.id, 1000);
    for (const f of files) if (f.mimeType !== MAP_MIME && f.name.endsWith(EXTENSIE_DB)) uit.push(f);
  }
  return uit;
}

/**
 * Bewaarbeleid toepassen (14 dagelijkse, 8 wekelijkse, 12 maandelijkse; altijd de nieuwste
 * 3). Alleen na een geslaagde upload aanroepen. Weg = naar de prullenbak van Drive.
 */
export async function ruimOudeBackupsOp(v: Verbinding, nu: number = Date.now()): Promise<number> {
  const alle = await lijstDbBackups(v);
  const weg = teVerwijderen(alle.map((b) => ({ id: b.id, naam: b.name })), nu);
  let n = 0;
  for (const b of weg) {
    try {
      await v.client.wijzig(b.id, { trashed: true });
      n++;
    } catch (e) {
      if (!(e instanceof DriveFout && e.code === 'niet_gevonden')) throw e;
    }
  }
  return n;
}

/** De map voor de storage-bestanden van één bucket. */
export function bestandenMap(v: Verbinding, bucket: string): Promise<string> {
  return zorgVoorPad(v, [BACKUP_MAP, BESTANDEN_MAP, bucket]);
}

/** Een versleuteld storage-bestand neerzetten of (bij een bekend Drive-id) vervangen. */
export async function uploadBestand(v: Verbinding, o: { ouderId: string; naam: string; inhoud: Uint8Array; driveId?: string | null }): Promise<DriveBestand> {
  if (o.driveId) {
    try {
      return await v.client.upload({ naam: o.naam, mime: MIME, inhoud: o.inhoud, id: o.driveId });
    } catch (e) {
      if (!(e instanceof DriveFout && e.code === 'niet_gevonden')) throw e;
    }
  }
  return v.client.upload({ naam: o.naam, mime: MIME, inhoud: o.inhoud, ouderId: o.ouderId });
}
