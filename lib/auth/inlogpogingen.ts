import 'server-only';
import { systeemClient } from '@/lib/supabase/systeem';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logFout } from '@/lib/log';
import { hashKort } from './hash';
import { beoordeel, LIMIETEN, type Limiet } from './limiet-kern';

// Pogingenlimiet voor inloggen, 2FA-codes en wachtwoord-vergeten. Mislukte pogingen staan
// (alleen als hash) in de tabel inlog_pogingen (migratie 0026), zodat de limiet ook geldt
// over meerdere serverinstanties. Zonder die tabel (vóór 0026) of bij een storing: een
// limiet in het geheugen van deze instantie (zachter, maar nooit iemand buitensluiten door
// een databasefout).

const geheugen = new Map<string, number[]>();
const MAX_VENSTER = 60 * 60_000;

function geheugenTijden(sleutel: string, nu: number): number[] {
  const t = (geheugen.get(sleutel) ?? []).filter((x) => x > nu - MAX_VENSTER);
  if (t.length) geheugen.set(sleutel, t);
  else geheugen.delete(sleutel);
  return t;
}

export const sleutels = {
  email: (email: string) => `e:${hashKort('email', email.trim().toLowerCase())}`,
  ip: (ip: string) => `i:${hashKort('ip', ip)}`,
  tfa: (userId: string) => `t:${hashKort('user', userId)}`,
  herstel: (email: string) => `w:${hashKort('email', email.trim().toLowerCase())}`
};

export function limietenInloggen(email: string, ip: string): Limiet[] {
  const l: Limiet[] = [{ sleutel: sleutels.email(email), ...LIMIETEN.inloggenEmail }];
  if (ip) l.push({ sleutel: sleutels.ip(ip), ...LIMIETEN.inloggenIp });
  return l;
}

/** Is één van de limieten bereikt? Geeft de langste wachttijd. */
export async function controleerLimieten(limieten: Limiet[]): Promise<{ geblokkeerd: boolean; wachtMs: number }> {
  const nu = Date.now();
  const venster = Math.max(...limieten.map((l) => l.vensterMs));
  let tijdenPer: Map<string, number[]> | null = null;
  try {
    const { data, error } = await systeemClient('inlogpogingen')
      .from('inlog_pogingen')
      .select('sleutel, op')
      .in('sleutel', limieten.map((l) => l.sleutel))
      .eq('gelukt', false)
      .gte('op', new Date(nu - venster).toISOString())
      .order('op', { ascending: false })
      .limit(200);
    if (error) {
      if (!tabelOntbreekt(error)) logFout('[inloggen] pogingen lezen', error);
    } else {
      tijdenPer = new Map();
      for (const r of (data ?? []) as { sleutel: string; op: string }[]) {
        const lijst = tijdenPer.get(r.sleutel) ?? [];
        lijst.push(Date.parse(r.op));
        tijdenPer.set(r.sleutel, lijst);
      }
    }
  } catch (e) {
    logFout('[inloggen] pogingen lezen', e);
  }

  let uit = { geblokkeerd: false, wachtMs: 0 };
  for (const l of limieten) {
    // De tabel als die er is; anders (vóór 0026 of bij een storing) het geheugen.
    const tijden = tijdenPer ? (tijdenPer.get(l.sleutel) ?? []) : geheugenTijden(l.sleutel, nu);
    const b = beoordeel(tijden, l.max, l.vensterMs, nu);
    if (b.geblokkeerd && b.wachtMs > uit.wachtMs) uit = b;
  }
  return uit;
}

/** Legt een poging vast. Gelukt: de mislukte pogingen van deze sleutels vervallen. */
export async function registreerPoging(sleutelLijst: string[], gelukt: boolean): Promise<void> {
  const nu = Date.now();
  for (const s of sleutelLijst) {
    if (gelukt) geheugen.delete(s);
    else geheugen.set(s, [...geheugenTijden(s, nu), nu]);
  }
  try {
    const sb = systeemClient('inlogpogingen');
    if (gelukt) {
      const { error } = await sb.from('inlog_pogingen').delete().in('sleutel', sleutelLijst).eq('gelukt', false);
      if (error && !tabelOntbreekt(error)) logFout('[inloggen] pogingen wissen', error);
    } else {
      const { error } = await sb.from('inlog_pogingen').insert(sleutelLijst.map((sleutel) => ({ sleutel, gelukt: false })));
      if (error && !tabelOntbreekt(error)) logFout('[inloggen] poging vastleggen', error);
    }
  } catch (e) {
    logFout('[inloggen] poging vastleggen', e);
  }
}

// ---------------------------------------------------------------------------------
// Eenvoudige limiet per gebruiker voor dure routes (AI: bonnetjes uitlezen, social
// genereren). In het geheugen per instantie: genoeg om een op hol geslagen script of een
// gestolen sessie af te remmen, zonder databaseverkeer.
// ---------------------------------------------------------------------------------
const gebruik = new Map<string, number[]>();

export function binnenGebruikslimiet(sleutel: string, maxPerUur: number): boolean {
  const nu = Date.now();
  const t = (gebruik.get(sleutel) ?? []).filter((x) => x > nu - 60 * 60_000);
  if (t.length >= maxPerUur) {
    gebruik.set(sleutel, t);
    return false;
  }
  t.push(nu);
  gebruik.set(sleutel, t);
  return true;
}
