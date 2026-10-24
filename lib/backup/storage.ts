import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bucketOntbreekt } from '@/lib/db/ontbreekt';
import type { StorageItem } from './formaat-kern';

// Alle bestanden in een storage-bucket (recursief), met grootte, datum en etag. Alleen
// metadata; de inhoud haalt de bestandensync zelf op. Een ontbrekende bucket = leeg.

const MAX_ITEMS = 20_000;
const PER_PAGINA = 1000;

interface ListItem {
  name: string;
  id: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  metadata?: { size?: number; mimetype?: string; eTag?: string; lastModified?: string } | null;
}

export async function lijstBucket(sb: SupabaseClient, bucket: string): Promise<StorageItem[]> {
  const uit: StorageItem[] = [];
  const mappen: string[] = [''];
  while (mappen.length) {
    const map = mappen.shift() as string;
    for (let offset = 0; ; offset += PER_PAGINA) {
      const { data, error } = await sb.storage.from(bucket).list(map, { limit: PER_PAGINA, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) {
        if (bucketOntbreekt(error)) return [];
        throw error;
      }
      const items = (data ?? []) as ListItem[];
      for (const it of items) {
        const pad = map ? `${map}/${it.name}` : it.name;
        if (it.id === null) {
          mappen.push(pad);
          continue;
        }
        if (it.name === '.emptyFolderPlaceholder') continue;
        uit.push({
          pad,
          grootte: typeof it.metadata?.size === 'number' ? it.metadata.size : null,
          bijgewerkt: it.updated_at ?? it.metadata?.lastModified ?? it.created_at ?? null,
          mime: it.metadata?.mimetype ?? null,
          etag: it.metadata?.eTag ? String(it.metadata.eTag).replace(/"/g, '').slice(0, 200) : null
        });
        if (uit.length >= MAX_ITEMS) return uit;
      }
      if (items.length < PER_PAGINA) break;
    }
  }
  return uit;
}
