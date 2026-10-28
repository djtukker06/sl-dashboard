import 'server-only';
import type { Teamlid } from './team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import {
  beheerFout,
  dbRolVan,
  initialenVoorstel,
  rolVan,
  type Gebruiker,
  type GebruikerWijziging,
  type NieuweGebruiker
} from './gebruikers-kern';

// Gebruikersbeheer voor de admin (/gebruikers). Alleen aan te roepen na eigenaarRoute (admin
// mét 2FA-sessie). Nieuwe accounts komen alleen hier vandaan: zelf registreren staat uit.
//
//   aanmaken     Auth-account met een tijdelijk wachtwoord (e-mail meteen bevestigd) +
//                profiel + teamlidmaatschap. app_metadata.wachtwoord_wijzigen = true: bij de
//                eerste login moet hij eerst een eigen wachtwoord kiezen (lib/auth/team.ts),
//                daarna de welkomstflow (2FA instellen, profiel).
//   wijzigen     naam/e-mail/initialen/kleur, rol, boekhouding, (de)activeren, en een nieuw
//                tijdelijk wachtwoord (zelfde verplichte wissel).
//   deactiveren  team_members.actief = false én het Auth-account geblokkeerd (ban): inloggen
//                kan niet meer, alles wat hij maakte blijft zichtbaar. Terugzetten kan.
//   verwijderen  het Auth-account weg; profiel en lidmaatschap verdwijnen mee (cascade), bij
//                facturen/taken blijft created_by leeg (0021).

export class BeheerFout extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

const BAN_LANG = '876000h'; // ~100 jaar: gedeactiveerd

interface LidRij {
  user_id: string;
  actief: boolean;
  rol: string;
  boekhouding?: boolean | null;
}

async function ledenRijen(sb: ReturnType<typeof createServiceRoleClient>): Promise<LidRij[]> {
  const { data, error } = await sb.from('team_members').select('*').limit(500);
  if (error) throw error;
  return (data ?? []) as LidRij[];
}

export async function gebruikersLijst(lid: Teamlid): Promise<{ gebruikers: Gebruiker[]; migratie: boolean }> {
  const sb = createServiceRoleClient(lid.bewijs);
  const [leden, profielRes, usersRes] = await Promise.all([
    ledenRijen(sb),
    sb.from('profiles').select('id, naam, initialen, kleur').limit(500),
    sb.auth.admin.listUsers({ page: 1, perPage: 500 })
  ]);
  if (usersRes.error) throw usersRes.error;
  const profielen = new Map(((profielRes.data ?? []) as { id: string; naam: string; initialen: string; kleur: string }[]).map((p) => [p.id, p]));
  const users = new Map((usersRes.data?.users ?? []).map((u) => [u.id, u]));
  const migratie = leden.length === 0 || leden.some((l) => 'boekhouding' in l);
  const gebruikers = leden
    .map((m): Gebruiker => {
      const u = users.get(m.user_id);
      const p = profielen.get(m.user_id);
      const naam = p?.naam || (u?.email ?? '').split('@')[0] || 'Teamlid';
      const rol = rolVan(m.rol);
      return {
        userId: m.user_id,
        naam,
        email: u?.email ?? '',
        initialen: p?.initialen || initialenVoorstel(naam) || '?',
        kleur: p?.kleur || '#c8a97e',
        rol,
        boekhouding: rol === 'admin' || m.boekhouding !== false,
        actief: m.actief === true,
        wachtwoordWijzigen: u?.app_metadata?.wachtwoord_wijzigen === true,
        factoren: (u?.factors ?? []).filter((f) => f.status === 'verified').length,
        laatstIngelogd: u?.last_sign_in_at ?? null,
        aangemaakt: u?.created_at ?? null,
        zelf: m.user_id === lid.userId
      };
    })
    .sort((a, b) => Number(b.actief) - Number(a.actief) || (a.rol === 'admin' ? -1 : 1) - (b.rol === 'admin' ? -1 : 1) || a.naam.localeCompare(b.naam, 'nl'));
  return { gebruikers, migratie };
}

function bestaatAl(e: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(e && (e.code === 'email_exists' || e.code === 'user_already_exists' || /already (been )?registered|already exists/i.test(e.message ?? '')));
}

export async function gebruikerAanmaken(lid: Teamlid, n: NieuweGebruiker): Promise<string> {
  const sb = createServiceRoleClient(lid.bewijs);
  const { data, error } = await sb.auth.admin.createUser({
    email: n.email,
    password: n.wachtwoord,
    email_confirm: true,
    app_metadata: { wachtwoord_wijzigen: true }
  });
  if (bestaatAl(error)) throw new BeheerFout(409, 'Er bestaat al een account met dit e-mailadres.');
  if (error) {
    if (error.code === 'weak_password') throw new BeheerFout(400, 'Dit wachtwoord is te zwak. Kies een langer wachtwoord.');
    throw error;
  }
  const id = data.user.id;
  try {
    const p = await sb.from('profiles').upsert({ id, naam: n.naam, initialen: n.initialen, kleur: n.kleur, email: n.email }, { onConflict: 'id' });
    if (p.error) throw p.error;
    const t = await sb.from('team_members').insert({ user_id: id, actief: true, rol: dbRolVan(n.rol), boekhouding: n.boekhouding });
    if (t.error) {
      if (tabelOntbreekt(t.error) || /boekhouding/.test(t.error.message ?? '')) {
        throw new BeheerFout(503, 'Voer eerst supabase/UITVOEREN_0028.sql uit in Supabase.');
      }
      throw t.error;
    }
  } catch (e) {
    // Half aangemaakt: het Auth-account weer weg (profiel gaat mee via cascade).
    await sb.auth.admin.deleteUser(id).catch(() => undefined);
    throw e;
  }
  return id;
}

async function controleer(lid: Teamlid, doelId: string, w: GebruikerWijziging | null) {
  const sb = createServiceRoleClient(lid.bewijs);
  const leden = await ledenRijen(sb);
  const fout = beheerFout(
    { doelId, zelfId: lid.userId, leden: leden.map((l) => ({ userId: l.user_id, rol: rolVan(l.rol), actief: l.actief === true })) },
    w
  );
  if (fout) throw new BeheerFout(fout.includes('bestaat niet') ? 404 : 400, fout);
  return { sb, huidig: leden.find((l) => l.user_id === doelId)! };
}

/** Geeft de namen van de gewijzigde velden terug (voor de audit-log, nooit de waarden). */
export async function gebruikerWijzigen(lid: Teamlid, doelId: string, w: GebruikerWijziging): Promise<string[]> {
  const { sb, huidig } = await controleer(lid, doelId, w);
  const velden: string[] = [];

  // 1. Auth-account: e-mail, tijdelijk wachtwoord, blokkeren/deblokkeren.
  const auth: Record<string, unknown> = {};
  if (w.email !== undefined) {
    auth.email = w.email;
    auth.email_confirm = true;
    velden.push('email');
  }
  if (w.wachtwoord !== undefined) {
    if (doelId === lid.userId) throw new BeheerFout(400, 'Je eigen wachtwoord wijzig je via Account › Wachtwoord wijzigen.');
    auth.password = w.wachtwoord;
    auth.app_metadata = { wachtwoord_wijzigen: true };
    velden.push('wachtwoord');
  }
  if (w.actief !== undefined && w.actief !== (huidig.actief === true)) {
    auth.ban_duration = w.actief ? 'none' : BAN_LANG;
  }
  if (Object.keys(auth).length) {
    const r = await sb.auth.admin.updateUserById(doelId, auth);
    if (bestaatAl(r.error)) throw new BeheerFout(409, 'Er bestaat al een account met dit e-mailadres.');
    if (r.error) throw r.error;
  }

  // 2. Profiel.
  const profiel: Record<string, string> = {};
  if (w.naam !== undefined) profiel.naam = w.naam;
  if (w.initialen !== undefined) profiel.initialen = w.initialen;
  if (w.kleur !== undefined) profiel.kleur = w.kleur;
  if (w.email !== undefined) profiel.email = w.email;
  if (Object.keys(profiel).length) {
    const r = await sb.from('profiles').update(profiel).eq('id', doelId);
    if (r.error) throw r.error;
    velden.push(...Object.keys(profiel).filter((k) => k !== 'email'));
  }

  // 3. Lidmaatschap: rol, boekhouding, actief.
  const team: Record<string, unknown> = {};
  if (w.rol !== undefined) team.rol = dbRolVan(w.rol);
  if (w.boekhouding !== undefined) team.boekhouding = w.boekhouding;
  if (w.actief !== undefined) {
    team.actief = w.actief;
    team.gedeactiveerd_op = w.actief ? null : new Date().toISOString();
  }
  if (Object.keys(team).length) {
    const r = await sb.from('team_members').update(team).eq('user_id', doelId);
    if (r.error) {
      if (/boekhouding/.test(r.error.message ?? '')) throw new BeheerFout(503, 'Voer eerst supabase/UITVOEREN_0028.sql uit in Supabase.');
      throw r.error;
    }
    velden.push(...Object.keys(team).filter((k) => k !== 'gedeactiveerd_op'));
  }
  return velden;
}

export async function gebruikerVerwijderen(lid: Teamlid, doelId: string): Promise<void> {
  const { sb } = await controleer(lid, doelId, null);
  const r = await sb.auth.admin.deleteUser(doelId);
  if (r.error) throw r.error;
}
