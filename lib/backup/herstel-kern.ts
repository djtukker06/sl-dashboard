// Vergelijken en voorbereiden van een herstel (scripts/backup-herstellen.mjs). Zonder env,
// database of '@/'-imports, zodat scripts/test-backup.mjs het los kan testen.

export interface TabelInfo {
  naam: string;
  pk: string[];
  zonder?: string[];
  alleenToevoegen?: boolean;
  zelfVerwijzing?: string;
}

export type Rij = Record<string, unknown>;

/** Stabiele JSON (sleutels gesorteerd), voor het vergelijken van rijen. */
export function stabiel(w: unknown): string {
  if (w === null || typeof w !== 'object') return JSON.stringify(w ?? null);
  if (Array.isArray(w)) return `[${w.map(stabiel).join(',')}]`;
  const o = w as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stabiel(o[k])}`)
    .join(',')}}`;
}

/** De sleutel van een rij (pk-waarden), of de hele rij als er geen pk bekend is. */
export function rijSleutel(rij: Rij, pk: string[]): string {
  return pk.length ? stabiel(pk.map((k) => rij[k] ?? null)) : stabiel(rij);
}

/** Zonder gegenereerde kolommen (die mag je niet schrijven). */
export function schoon(rij: Rij, t: Pick<TabelInfo, 'zonder'>): Rij {
  if (!t.zonder?.length) return rij;
  const uit: Rij = { ...rij };
  for (const k of t.zonder) delete uit[k];
  return uit;
}

export interface Verschil {
  nieuw: Rij[];
  gewijzigd: Rij[];
  gelijk: number;
  /** In de database maar niet in de back-up (alleen weg met --ook-verwijderen). */
  ontbrekend: Rij[];
}

export function vergelijkTabel(backup: Rij[], huidig: Rij[], t: TabelInfo): Verschil {
  const nu = new Map(huidig.map((r) => [rijSleutel(r, t.pk), r]));
  const inBackup = new Set<string>();
  const v: Verschil = { nieuw: [], gewijzigd: [], gelijk: 0, ontbrekend: [] };
  for (const r of backup) {
    const k = rijSleutel(r, t.pk);
    inBackup.add(k);
    const h = nu.get(k);
    if (!h) v.nieuw.push(r);
    else if (stabiel(schoon(h, t)) !== stabiel(schoon(r, t))) v.gewijzigd.push(r);
    else v.gelijk++;
  }
  for (const [k, r] of nu) if (!inBackup.has(k)) v.ontbrekend.push(r);
  return v;
}

/**
 * De schrijfstappen voor één tabel: eerst de rijen zelf (bij een verwijzing naar dezelfde
 * tabel met die kolom leeg), daarna alleen die kolom invullen. Geen stappen voor een
 * tabel zonder pk (dan weet je niet wat je overschrijft).
 */
export function schrijfPlan(rijen: Rij[], t: TabelInfo): { upsert: Rij[]; daarna: Rij[] } {
  if (!t.pk.length) return { upsert: [], daarna: [] };
  const upsert = rijen.map((r) => {
    const s = schoon(r, t);
    if (t.zelfVerwijzing && s[t.zelfVerwijzing] != null) return { ...s, [t.zelfVerwijzing]: null };
    return s;
  });
  const daarna = t.zelfVerwijzing
    ? rijen
        .filter((r) => r[t.zelfVerwijzing as string] != null)
        .map((r) => ({ ...Object.fromEntries(t.pk.map((k) => [k, r[k]])), [t.zelfVerwijzing as string]: r[t.zelfVerwijzing as string] }))
    : [];
  return { upsert, daarna };
}

/** Projectreferentie uit de host ("abcd.supabase.co" → "abcd"). */
export function projectRef(host: string): string {
  return String(host || '').split('.')[0] || 'onbekend';
}
