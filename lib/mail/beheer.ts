import 'server-only';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { logAudit } from '@/lib/audit';
import { teamProfielen } from '@/lib/team/profielen';
import { valideerMailbox, type MailboxInvoer } from '@/lib/account/types';
import { eigenMailboxRij, type MailboxRij } from './config';
import { KOPPEL_MELDING, MailFout, type AppWachtwoordHint } from './fout';
import { kluisBeschikbaar, ontsleutel, SLEUTEL_VERSIE, versleutel } from './kluis';
import { magProberen, testMailbox } from './koppelen';
import { MAILBOXEN_KOLOMMEN, vergeetMailboxen, zichtbareMailboxen, type MailboxenRij, type Mailbox, type MailboxOpslag } from './mailboxen';
import { zoekMx } from './mx';
import { instellingenVoor, vasteInstellingen } from './providers';
import {
  MAX_MAILBOXEN,
  naarDto,
  OUDE_MAILBOX_ID,
  standaardLabel,
  valideerMailboxMeta,
  valideerVolgorde,
  volgendeKleur,
  type InboxDto
} from './zichtbaarheid';

// Inboxen beheren (Account & mail): koppelen met één knop, naam/kleur/zichtbaarheid wijzigen,
// volgorde, ontkoppelen. Alles gaat ALLEEN over de eigen rijen van de ingelogde gebruiker
// (eigenaar_id = eigen sessie-id). Het wachtwoord gaat erin (na een geslaagde test, versleuteld
// met eigenaar_id als AAD), nooit eruit.
//
// Vóór migratie 0026 (geen tabel mailboxen) werkt alles zoals daarvoor: één eigen inbox in
// user_mailboxes; koppelen vervangt die, extra inboxen/delen kan dan nog niet.

export type Uitkomst<T> = { ok: true; waarde: T } | { ok: false; status: number; error: string; code?: string };

const mis = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({
  ok: false,
  status,
  error,
  code
});

export const NIET_INGERICHT =
  'Een eigen mailbox koppelen kan pas als de teambeveiliging actief is: voer in Supabase supabase/UITVOEREN_0021_TEAM.sql uit.';
export const GEEN_SLEUTEL =
  'Koppelen staat uit: de server heeft nog geen MAIL_ENCRYPTION_KEY (zie README, "Mail per gebruiker").';
export const ZONDER_0026 =
  'Meerdere inboxen en delen met het team kan zodra migratie 0026 is uitgevoerd (supabase/UITVOEREN_0026.sql).';

/** Een eigen inbox zoals /account hem toont. Servers alleen van je EIGEN inbox; nooit een wachtwoord. */
export interface EigenInbox extends InboxDto {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  geverifieerdOp: string | null;
}

export interface MailboxenOverzicht {
  opslag: MailboxOpslag;
  /** MAIL_ENCRYPTION_KEY staat (geldig) op de server. */
  sleutel: boolean;
  max: number;
  eigen: EigenInbox[];
  /** Inboxen die andere teamleden met het team delen (alleen lezen). */
  gedeeld: InboxDto[];
  /** De standaard-mailbox uit de serverinstellingen, als die van jou is. */
  standaard: InboxDto | null;
}

function eigenInbox(m: Mailbox): EigenInbox {
  return {
    ...naarDto(m),
    imapHost: m.imapHost,
    imapPort: m.imapPort,
    smtpHost: m.smtpHost,
    smtpPort: m.smtpPort,
    geverifieerdOp: m.geverifieerdOp
  };
}

/** Overzicht voor /account (vers opgehaald, niet uit de cache). */
export async function mailboxenOverzicht(lid: Teamlid): Promise<MailboxenOverzicht> {
  vergeetMailboxen();
  const { lijst, opslag } = await zichtbareMailboxen(lid);
  const standaard = lijst.find((m) => m.soort === 'env');
  return {
    opslag,
    sleutel: kluisBeschikbaar(),
    max: opslag === 'nieuw' ? MAX_MAILBOXEN : 1,
    eigen: lijst.filter((m) => m.vanMij && m.soort !== 'env').map(eigenInbox),
    gedeeld: lijst.filter((m) => !m.vanMij).map(naarDto),
    standaard: standaard ? naarDto(standaard) : null
  };
}

/** Waar staan de inboxen nu? Vers (niet uit de cache) en met de eigen rijen erbij. */
async function eigenRijen(lid: Teamlid): Promise<{ opslag: 'nieuw'; rijen: MailboxenRij[] } | { opslag: 'oud'; rij: MailboxRij | null }> {
  const { data, error } = await createServiceRoleClient(lid.bewijs)
    .from('mailboxen')
    .select(MAILBOXEN_KOLOMMEN)
    .eq('eigenaar_id', lid.userId)
    .order('volgorde', { ascending: true })
    .order('gekoppeld_op', { ascending: true });
  if (!error) return { opslag: 'nieuw', rijen: (data ?? []) as unknown as MailboxenRij[] };
  if (!tabelOntbreekt(error)) {
    console.error('[mailboxen] eigen inboxen ophalen mislukt', error.code ?? '');
    throw new Error('Kon je inboxen niet ophalen.');
  }
  const { rij, ingericht } = await eigenMailboxRij(lid);
  if (!ingericht) throw new MailFout(409, 'ongeldig', NIET_INGERICHT);
  return { opslag: 'oud', rij };
}

/** Deelt een ander actief teamlid dit adres al met het team? Dan de naam van die persoon. */
async function alGedeeldDoor(lid: Teamlid, email: string, behalveId?: string): Promise<string | null> {
  const { data, error } = await createServiceRoleClient(lid.bewijs)
    .from('mailboxen')
    .select('id, eigenaar_id, email')
    .eq('zichtbaarheid', 'team')
    .neq('eigenaar_id', lid.userId)
    .limit(200);
  if (error) return null;
  const rijen = ((data ?? []) as { id: string; eigenaar_id: string; email: string }[]).filter(
    (r) => r.id !== behalveId && r.email.toLowerCase() === email.toLowerCase()
  );
  if (!rijen.length) return null;
  const team = await teamProfielen(lid);
  const actief = rijen.find((r) => team.some((p) => p.id === r.eigenaar_id && p.actief));
  return actief ? (team.find((p) => p.id === actief.eigenaar_id)?.naam ?? 'een teamlid') : null;
}

/** Zelfde adres, servers en poorten als het opgeslagen record? (hosts zonder hoofdletters) */
export function zelfdeVerbinding(
  rij: { email: string; imap_host: string; imap_port: number; smtp_host: string; smtp_port: number },
  invoer: { email: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }
): boolean {
  const gelijk = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
  return (
    gelijk(rij.email, invoer.email) &&
    gelijk(rij.imap_host, invoer.imapHost) &&
    Number(rij.imap_port) === invoer.imapPort &&
    gelijk(rij.smtp_host, invoer.smtpHost) &&
    Number(rij.smtp_port) === invoer.smtpPort
  );
}

/**
 * Koppelen met één knop: { email, wachtwoord } (servers afgeleid uit het adres) of met zelf
 * ingevulde servers, plus optioneel label, kleur, zichtbaarheid, fromName, handtekening.
 * Eerst echt inloggen (IMAP + SMTP), dan versleuteld opslaan. Hetzelfde adres opnieuw
 * koppelen werkt de bestaande inbox bij (id en instellingen blijven).
 * Leeg wachtwoord = het opgeslagen wachtwoord houden, ALLEEN bij precies dezelfde verbinding.
 */
export async function koppelMailbox(lid: Teamlid, o: Record<string, unknown>, request?: Request): Promise<Uitkomst<{ id: string; email: string }>> {
  if (lid.overgang) return mis(409, NIET_INGERICHT, 'niet_ingericht');
  if (!kluisBeschikbaar()) return mis(503, GEEN_SLEUTEL, 'geen_sleutel');

  const v = valideerMailbox(o);
  if (!v.ok) return mis(400, v.fout);
  const invoer: MailboxInvoer = v.waarde;
  const meta = valideerMailboxMeta({ label: o.label, kleur: o.kleur, zichtbaarheid: o.zichtbaarheid });
  if (!meta.ok) return mis(400, meta.fout);

  // Servers zelf ingevuld, of (één knop) afleiden uit het adres.
  const gevuld = (x: unknown) => typeof x === 'string' && x.trim() !== '';
  const handmatig = gevuld(o.imapHost) || gevuld(o.smtpHost);
  const vast = vasteInstellingen(invoer.email);
  let hint: AppWachtwoordHint | null =
    vast.soort === 'bekend' && vast.appWachtwoord && vast.provider !== 'privateemail' ? vast.provider : null;
  if (!handmatig) {
    const p = await instellingenVoor(invoer.email, zoekMx);
    if (p.soort === 'microsoft') return mis(400, KOPPEL_MELDING.microsoft, 'provider_microsoft');
    if (p.soort === 'onbekend') return mis(400, KOPPEL_MELDING.onbekend, 'provider_onbekend');
    invoer.imapHost = p.imapHost;
    invoer.imapPort = p.imapPort;
    invoer.smtpHost = p.smtpHost;
    invoer.smtpPort = p.smtpPort;
    hint = p.appWachtwoord && p.provider !== 'privateemail' ? p.provider : null;
  }

  let huidig: Awaited<ReturnType<typeof eigenRijen>>;
  try {
    huidig = await eigenRijen(lid);
  } catch (e) {
    if (e instanceof MailFout) return mis(e.status, e.message, 'niet_ingericht');
    throw e;
  }
  // Vóór 0026 is er één inbox: koppelen vervangt hem. Daarna: hetzelfde adres = bijwerken.
  const bestaand: MailboxenRij | MailboxRij | null =
    huidig.opslag === 'nieuw' ? (huidig.rijen.find((r) => r.email.toLowerCase() === invoer.email) ?? null) : huidig.rij;

  if (huidig.opslag === 'nieuw' && !bestaand) {
    if (huidig.rijen.length >= MAX_MAILBOXEN) return mis(409, `Je kunt maximaal ${MAX_MAILBOXEN} inboxen koppelen.`, 'te_veel');
    const door = await alGedeeldDoor(lid, invoer.email);
    if (door) return mis(409, `Deze inbox is al gedeeld met het team door ${door}; je ziet hem al in Mail.`, 'al_gedeeld');
  }
  if (huidig.opslag === 'oud' && (meta.waarde.zichtbaarheid === 'team')) return mis(409, ZONDER_0026, 'zonder_0026');
  if (huidig.opslag === 'nieuw' && meta.waarde.zichtbaarheid === 'team' && bestaand) {
    const door = await alGedeeldDoor(lid, invoer.email, (bestaand as MailboxenRij).id);
    if (door) return mis(409, `Deze inbox is al gedeeld met het team door ${door}.`, 'al_gedeeld');
  }

  // Afzendernaam en handtekening: niet meegestuurd = de bewaarde waarde houden; bij een
  // nieuwe koppeling je profielnaam en geen handtekening.
  if (!('fromName' in o) || (!bestaand && !invoer.fromName)) invoer.fromName = bestaand?.from_name || lid.profiel.naam;
  if (!('handtekening' in o)) invoer.handtekening = bestaand?.handtekening ?? '';
  if (!invoer.wachtwoord) {
    // Het opgeslagen wachtwoord alleen hergebruiken als de HELE verbinding gelijk blijft;
    // anders zou een gestolen sessie het naar een eigen server kunnen laten sturen.
    const zelfde = bestaand !== null && zelfdeVerbinding(bestaand, invoer);
    const bewaard = bestaand && zelfde ? ontsleutel(bestaand.wachtwoord_enc, lid.userId) : null;
    if (!bewaard) {
      return mis(
        400,
        bestaand && !zelfde ? 'Je wijzigt de server of het adres: vul je wachtwoord opnieuw in.' : 'Vul je wachtwoord in.',
        'wachtwoord_nodig'
      );
    }
    invoer.wachtwoord = bewaard;
  }

  if (!magProberen(lid.userId)) return mis(429, KOPPEL_MELDING.teVaak, 'te_vaak');
  try {
    await testMailbox(invoer, hint);
  } catch (e) {
    if (e instanceof MailFout) return mis(e.status >= 500 ? 502 : e.status, e.message, e.code);
    throw e;
  }

  const sb = createServiceRoleClient(lid.bewijs);
  const verbinding = {
    email: invoer.email,
    imap_host: invoer.imapHost,
    imap_port: invoer.imapPort,
    smtp_host: invoer.smtpHost,
    smtp_port: invoer.smtpPort,
    from_name: invoer.fromName,
    handtekening: invoer.handtekening,
    wachtwoord_enc: versleutel(invoer.wachtwoord, lid.userId),
    sleutel_versie: SLEUTEL_VERSIE,
    geverifieerd_op: new Date().toISOString()
  };

  let id = OUDE_MAILBOX_ID;
  if (huidig.opslag === 'oud') {
    const { error } = await sb.from('user_mailboxes').upsert({ user_id: lid.userId, ...verbinding }, { onConflict: 'user_id' });
    if (error) {
      console.error('[mailboxen] opslaan mislukt', error.code ?? '');
      return mis(500, 'Opslaan is niet gelukt. Probeer het opnieuw.');
    }
  } else if (bestaand) {
    id = (bestaand as MailboxenRij).id;
    const { error } = await sb
      .from('mailboxen')
      .update({ ...verbinding, ...metaKolommen(meta.waarde) })
      .eq('id', id)
      .eq('eigenaar_id', lid.userId);
    if (error) {
      console.error('[mailboxen] bijwerken mislukt', error.code ?? '');
      return mis(500, 'Opslaan is niet gelukt. Probeer het opnieuw.');
    }
  } else {
    const volgorde = huidig.rijen.reduce((max, r) => Math.max(max, r.volgorde ?? 0), -1) + 1;
    const { data, error } = await sb
      .from('mailboxen')
      .insert({
        eigenaar_id: lid.userId,
        ...verbinding,
        label: meta.waarde.label ?? standaardLabel(invoer.email),
        kleur: meta.waarde.kleur ?? volgendeKleur(huidig.rijen.map((r) => r.kleur)),
        zichtbaarheid: meta.waarde.zichtbaarheid ?? 'prive',
        volgorde
      })
      .select('id')
      .single();
    if (error || !data) {
      if (error?.code === '23505') return mis(409, 'Deze inbox is al gekoppeld.', 'al_gekoppeld');
      console.error('[mailboxen] opslaan mislukt', error?.code ?? '');
      return mis(500, 'Opslaan is niet gelukt. Probeer het opnieuw.');
    }
    id = (data as { id: string }).id;
  }

  vergeetMailboxen();
  await logAudit('mailbox_gekoppeld', {
    lid,
    doel: `mailbox:${id}`,
    details: { adres: invoer.email, zichtbaarheid: meta.waarde.zichtbaarheid ?? (bestaand && 'zichtbaarheid' in bestaand ? bestaand.zichtbaarheid : 'prive') }
  }, request);
  return { ok: true, waarde: { id, email: invoer.email } };
}

function metaKolommen(m: { label?: string; kleur?: string; zichtbaarheid?: string; fromName?: string; handtekening?: string }) {
  const uit: Record<string, string> = {};
  if (m.label !== undefined) uit.label = m.label;
  if (m.kleur !== undefined) uit.kleur = m.kleur;
  if (m.zichtbaarheid !== undefined) uit.zichtbaarheid = m.zichtbaarheid;
  if (m.fromName !== undefined) uit.from_name = m.fromName;
  if (m.handtekening !== undefined) uit.handtekening = m.handtekening;
  return uit;
}

/** Naam, kleur, zichtbaarheid, afzendernaam of handtekening van een EIGEN inbox wijzigen. */
export async function wijzigMailbox(lid: Teamlid, id: string, o: Record<string, unknown>, request?: Request): Promise<Uitkomst<null>> {
  if (lid.overgang) return mis(409, NIET_INGERICHT, 'niet_ingericht');
  const meta = valideerMailboxMeta(o);
  if (!meta.ok) return mis(400, meta.fout);
  const kolommen = metaKolommen(meta.waarde);
  if (!Object.keys(kolommen).length) return mis(400, 'Niets om te wijzigen.');

  const sb = createServiceRoleClient(lid.bewijs);
  const { data, error } = await sb.from('mailboxen').select('id, email, zichtbaarheid').eq('id', id).eq('eigenaar_id', lid.userId).maybeSingle();
  if (error) {
    if (tabelOntbreekt(error)) return mis(409, ZONDER_0026, 'zonder_0026');
    console.error('[mailboxen] ophalen mislukt', error.code ?? '');
    return mis(500, 'Opslaan is niet gelukt. Probeer het opnieuw.');
  }
  const rij = data as { id: string; email: string; zichtbaarheid: string } | null;
  if (!rij) return mis(404, 'Deze inbox bestaat niet (meer).', 'niet_gevonden');
  if (meta.waarde.zichtbaarheid === 'team' && rij.zichtbaarheid !== 'team') {
    const door = await alGedeeldDoor(lid, rij.email, rij.id);
    if (door) return mis(409, `Deze inbox is al gedeeld met het team door ${door}.`, 'al_gedeeld');
  }
  const upd = await sb.from('mailboxen').update(kolommen).eq('id', id).eq('eigenaar_id', lid.userId);
  if (upd.error) {
    console.error('[mailboxen] wijzigen mislukt', upd.error.code ?? '');
    return mis(500, 'Opslaan is niet gelukt. Probeer het opnieuw.');
  }
  vergeetMailboxen();
  const zichtbaarheidGewijzigd = meta.waarde.zichtbaarheid !== undefined && meta.waarde.zichtbaarheid !== rij.zichtbaarheid;
  await logAudit(zichtbaarheidGewijzigd ? 'mailbox_zichtbaarheid' : 'mailbox_gewijzigd', {
    lid,
    doel: `mailbox:${id}`,
    details: { adres: rij.email, velden: Object.keys(kolommen), ...(zichtbaarheidGewijzigd ? { van: rij.zichtbaarheid, naar: meta.waarde.zichtbaarheid } : {}) }
  }, request);
  return { ok: true, waarde: null };
}

/** Nieuwe volgorde van je eigen inboxen (lijst met alle eigen id's). */
export async function zetVolgorde(lid: Teamlid, ids: unknown): Promise<Uitkomst<null>> {
  if (lid.overgang) return mis(409, NIET_INGERICHT, 'niet_ingericht');
  const sb = createServiceRoleClient(lid.bewijs);
  const { data, error } = await sb.from('mailboxen').select('id').eq('eigenaar_id', lid.userId);
  if (error) return tabelOntbreekt(error) ? mis(409, ZONDER_0026, 'zonder_0026') : mis(500, 'Opslaan is niet gelukt.');
  const volgorde = valideerVolgorde(ids, ((data ?? []) as { id: string }[]).map((r) => r.id));
  if (!volgorde) return mis(400, 'Ongeldige volgorde.');
  for (const [i, id] of volgorde.entries()) {
    const r = await sb.from('mailboxen').update({ volgorde: i }).eq('id', id).eq('eigenaar_id', lid.userId);
    if (r.error) return mis(500, 'Opslaan is niet gelukt.');
  }
  vergeetMailboxen();
  return { ok: true, waarde: null };
}

/** Een EIGEN inbox ontkoppelen: het record (met het versleutelde wachtwoord) wordt verwijderd. */
export async function ontkoppelMailbox(lid: Teamlid, id: string, request?: Request): Promise<Uitkomst<null>> {
  if (lid.overgang) return mis(409, NIET_INGERICHT, 'niet_ingericht');
  const sb = createServiceRoleClient(lid.bewijs);
  let adres = '';
  if (id === OUDE_MAILBOX_ID) {
    // Vóór 0026: de ene rij in user_mailboxes.
    const { data } = await sb.from('user_mailboxes').select('email').eq('user_id', lid.userId).maybeSingle();
    adres = (data as { email?: string } | null)?.email ?? '';
    const { error } = await sb.from('user_mailboxes').delete().eq('user_id', lid.userId);
    if (error) {
      console.error('[mailboxen] ontkoppelen mislukt', error.code ?? '');
      return mis(500, 'Ontkoppelen is niet gelukt. Probeer het opnieuw.');
    }
  } else {
    const { data, error } = await sb.from('mailboxen').select('id, email').eq('id', id).eq('eigenaar_id', lid.userId).maybeSingle();
    if (error) {
      if (tabelOntbreekt(error)) return mis(404, 'Deze inbox bestaat niet (meer).', 'niet_gevonden');
      console.error('[mailboxen] ophalen mislukt', error.code ?? '');
      return mis(500, 'Ontkoppelen is niet gelukt. Probeer het opnieuw.');
    }
    const rij = data as { id: string; email: string } | null;
    if (!rij) return mis(404, 'Deze inbox bestaat niet (meer).', 'niet_gevonden');
    adres = rij.email;
    const del = await sb.from('mailboxen').delete().eq('id', id).eq('eigenaar_id', lid.userId);
    if (del.error) {
      console.error('[mailboxen] ontkoppelen mislukt', del.error.code ?? '');
      return mis(500, 'Ontkoppelen is niet gelukt. Probeer het opnieuw.');
    }
    // De oude kopie (van vóór 0026) ook weg, zodat opnieuw uitvoeren van 0026 hem niet terugzet.
    const oud = await sb.from('user_mailboxes').select('email').eq('user_id', lid.userId).maybeSingle();
    if (!oud.error && (oud.data as { email?: string } | null)?.email?.toLowerCase() === rij.email.toLowerCase()) {
      await sb.from('user_mailboxes').delete().eq('user_id', lid.userId);
    }
  }
  vergeetMailboxen();
  await logAudit('mailbox_ontkoppeld', { lid, doel: `mailbox:${id}`, details: { adres } }, request);
  return { ok: true, waarde: null };
}
