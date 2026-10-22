// Datum- en tijdhulpjes voor het dashboard, altijd in Nederlandse tijd (de server draait in UTC).
const TZ = 'Europe/Amsterdam';

function delen(datum: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(datum)
      .map((x) => [x.type, x.value])
  );
  return { j: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/** ISO-weeknummer van de Nederlandse kalenderdag. */
export function isoWeek(datum = new Date()): number {
  const { j, m, d } = delen(datum);
  const t = new Date(Date.UTC(j, m - 1, d));
  const dag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dag);
  const jaarStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - jaarStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Bv. "donderdag 22 oktober". */
export function dagLabel(datum = new Date()): string {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(datum);
}

export function groet(datum = new Date()): string {
  const uur = Number(new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: 'numeric', hour12: false }).format(datum));
  return uur < 6 ? 'Goedenacht' : uur < 12 ? 'Goedemorgen' : uur < 18 ? 'Goedemiddag' : 'Goedenavond';
}

/** "zojuist", "12 min geleden", "3 u geleden", "gisteren", "4 dagen geleden", anders "12 sep". */
export function relatief(iso: string, nu = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const sec = Math.max(0, (nu.getTime() - t.getTime()) / 1000);
  if (sec < 60) return 'zojuist';
  if (sec < 3600) return `${Math.floor(sec / 60)} min geleden`;
  const a = delen(nu);
  const b = delen(t);
  const dagen = Math.round((Date.UTC(a.j, a.m - 1, a.d) - Date.UTC(b.j, b.m - 1, b.d)) / 86_400_000);
  if (dagen === 0) return `${Math.floor(sec / 3600)} u geleden`;
  if (dagen === 1) return 'gisteren';
  if (dagen < 7) return `${dagen} dagen geleden`;
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    ...(a.j !== b.j ? { year: 'numeric' as const } : {})
  }).format(t);
}

/** Korte datum, bv. "22 okt". */
export function korteDatum(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, day: 'numeric', month: 'short' }).format(t);
}
