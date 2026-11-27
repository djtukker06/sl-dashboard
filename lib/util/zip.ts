import { ZipArchive } from 'archiver';

export type ZipEntry = { name: string; data: Buffer | string };

/** Bouwt een ZIP in het geheugen (archiver v8); gebruikt door de export van de bonnetjes. */
export async function zipBuffer(entries: ZipEntry[]): Promise<Buffer> {
  const zip = new ZipArchive();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.on('data', (c: Buffer) => chunks.push(c));
    zip.on('end', () => resolve(Buffer.concat(chunks)));
    zip.on('error', reject);
  });
  for (const e of entries) zip.append(e.data, { name: e.name });
  await zip.finalize();
  return done;
}
