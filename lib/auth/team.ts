import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { tabelOntbreekt } from '@/lib/db/ontbreekt';
import { veiligVervolg } from '@/lib/vervolg';
import { welkomKlaarVan } from '@/lib/account/types';
import { logFout } from '@/lib/log';
import { eigenHerkomst, isWijzigend } from './herkomst';
import { afdwingenUitEnv, alsAal, tfaStap, type Aal, type TfaStap } from './tfa-kern';

// DE centrale toegangscontrole van de backoffice. Elke pagina, server action en API-route
// gaat hierlangs vóór er data wordt gelezen of geschreven — en zeker vóór de service-role.
//
//   1. getUser(): de sessie wordt bij de Auth-server gecontroleerd (een uitgelogde,
//      geblokkeerde of verwijderde gebruiker valt meteen af, niet pas na een uur). Bewust
//      niet alleen de handtekening lokaal controleren (zoals proxy.ts doet): dan bleef een
//      token na uitloggen nog tot een uur bruikbaar voor de routes die met de service-role
//      werken (mail, social);
//   2. team_members: alleen een ACTIEF teamlid komt erin (de allowlist uit migratie 0021).
//      Een account zonder lidmaatschap — bv. iemand die zich toch heeft weten te
//      registreren — krijgt "geen toegang".
//
// Snelheid: 1 en 2 lopen TEGELIJK (één rondgang i.p.v. twee na elkaar). Dat kan omdat
// stap 2 niet op het user-id filtert maar de (kleine) tabellen team_members en profiles van
// het team ophaalt — RLS laat een niet-lid alleen zijn eigen lidmaatschap zien. De uitkomst
// van 2 telt pas als 1 is gelukt. Zo heeft de shell (avatars, kiezers;
// lib/team/profielen.ts) daarna ook niets meer op te vragen.
//
//   3. tweestapsverificatie (2FA, migratie 0026): heeft iemand een factor en staat zijn sessie
//      nog op aal1, dan eerst de code (status 'tfa', stap 'uitdaging'); heeft hij er geen en
//      staat afdwingen aan (MFA_AFDWINGEN, standaard aan) en is 0026 uitgevoerd, dan eerst
//      instellen (stap 'instellen'). Zie lib/auth/tfa-kern.ts. Zo'n sessie krijgt GEEN bewijs
//      (dus geen service-role) en alleen de 2FA-routes en -pagina's werken.
//
// Overgangsmodus: zolang migratie 0021 niet is uitgevoerd (tabel team_members bestaat
// nog niet) geldt elke ingelogde, niet-anonieme gebruiker als lid — precies de
// beveiliging van vóór 0021 — en toont de shell een banner. Sinds 0021 overal is
// uitgevoerd staat dat standaard UIT (TEAM_VEREIST, standaard aan): een ontbrekende tabel
// (bv. een hapering in de schema-cache) geeft dan een storing in plaats van open deuren.
// Elke andere fout bij het controleren laat NIEMAND door (fail closed).

// ---------------------------------------------------------------------------------
// Bewijs: alleen deze module kan het maken. De service-role client eist er een,
// zodat code die de service-role zonder controle gebruikt niet compileert (en een
// nagemaakt object tijdens het draaien wordt geweigerd).
// ---------------------------------------------------------------------------------
declare const BEWIJS: unique symbol;
export type TeamlidBewijs = { readonly [BEWIJS]: true };

const uitgegeven = new WeakSet<object>();

function maakBewijs(): TeamlidBewijs {
  const b = Object.freeze({}) as TeamlidBewijs;
  uitgegeven.add(b);
  return b;
}

export function isGeldigBewijs(b: unknown): b is TeamlidBewijs {
  return typeof b === 'object' && b !== null && uitgegeven.has(b);
}

/**
 * Bewijs voor een vaste lijst systeemtaken zonder ingelogd teamlid (audit-log, de
 * pogingenlimiet, de cron na controle van CRON_SECRET). ALLEEN voor lib/supabase/systeem.ts;
 * scripts/test-beveiliging.mjs controleert dat niemand anders dit importeert.
 */
export type SysteemDoel = 'audit' | 'inlogpogingen' | 'cron' | 'wachtwoord' | 'agendafeed';
const SYSTEEM_DOELEN = new Set<SysteemDoel>(['audit', 'inlogpogingen', 'cron', 'wachtwoord', 'agendafeed']);
export function systeemBewijs(doel: SysteemDoel): TeamlidBewijs {
  if (!SYSTEEM_DOELEN.has(doel)) throw new Error('Onbekend systeemdoel.');
  return maakBewijs();
}

// Voor diep liggende code (Storage-hulpjes van social/uitgaven) die binnen een
// gecontroleerde route draait: de wrapper zet het teamlid in de context van het verzoek.
const context = new AsyncLocalStorage<Teamlid>();

export function metTeamlid<T>(lid: Teamlid, fn: () => T): T {
  if (!isGeldigBewijs(lid.bewijs)) throw new Error('Ongeldig teamlid-bewijs.');
  return context.run(lid, fn);
}

/** Het teamlid van het lopende verzoek; gooit als er geen teamlidcontrole aan voorafging. */
export function teamlidUitContext(): Teamlid {
  const lid = context.getStore();
  if (!lid || !isGeldigBewijs(lid.bewijs)) {
    throw new Error('Service-role gevraagd zonder voorafgaande teamlidcontrole.');
  }
  return lid;
}

/** Het bewijs van het lopende verzoek (zie teamlidUitContext). */
export function bewijsUitContext(): TeamlidBewijs {
  return teamlidUitContext().bewijs;
}

// ---------------------------------------------------------------------------------
// Het teamlid
// ---------------------------------------------------------------------------------
export type Rol = 'eigenaar' | 'lid';

export interface Factor {
  id: string;
  naam: string;
  aangemaakt: string;
}

/** Hoe 2FA er voor deze sessie bij staat. */
export interface TfaInfo {
  /** Geverifieerde TOTP-factoren. */
  factoren: Factor[];
  aal: Aal;
  /** Afdwingen staat aan (MFA_AFDWINGEN niet 'uit'). */
  afdwingen: boolean;
  /** Migratie 0026 is uitgevoerd (toegang_status bestaat). */
  migratie: boolean;
  /** Database-noodstop: false = 2FA telt in RLS even niet mee. */
  rls: boolean;
}

export interface Profiel {
  naam: string;
  voornaam: string;
  initialen: string;
  kleur: string;
}

export interface Teamlid {
  userId: string;
  email: string;
  naam: string;
  profiel: Profiel;
  rol: Rol;
  /** Volledige boekhouding (boekingen, bank, btw, rapporten). false = alleen facturen,
   *  klanten en bonnetjes (team_members.boekhouding, migratie 0028; zonder kolom: true). */
  boekhouding: boolean;
  /** false = de welkomstflow (/welkom) nog doorlopen. true als hij klaar is, en ook zonder
   *  kolom profiles.welkom_klaar_op (migratie 0022 nog niet uitgevoerd) of zonder profiel. */
  welkomKlaar: boolean;
  /** true zolang migratie 0021 niet is uitgevoerd (zie boven). */
  overgang: boolean;
  /** Gebruikerscliënt (RLS geldt). */
  sb: SupabaseClient;
  bewijs: TeamlidBewijs;
  tfa: TfaInfo;
  /** De profielen en lidmaatschappen van het team, al opgehaald bij de controle (voor
   *  lib/team/profielen.ts). Alleen wat RLS dit teamlid laat zien. */
  team?: TeamRijen;
}

export interface TeamRijen {
  profielen: { id: string; naam?: string | null; initialen?: string | null; kleur?: string | null }[];
  leden: { user_id: string; actief: boolean }[];
}

/** Een ingelogd teamlid dat eerst nog iets met 2FA moet (geen bewijs, geen data). */
export interface TfaSessie {
  userId: string;
  email: string;
  naam: string;
  profiel: Profiel;
  rol: Rol;
  welkomKlaar: boolean;
  sb: SupabaseClient;
  tfa: TfaInfo;
  stap: TfaStap;
}

export type TeamStatus =
  | { soort: 'anoniem' }
  | { soort: 'geen_toegang' }
  | { soort: 'storing' }
  | { soort: 'tfa'; stap: 'uitdaging' | 'instellen'; sessie: TfaSessie }
  /** Inloggen met een tijdelijk wachtwoord van de admin: eerst zelf een nieuw kiezen. */
  | { soort: 'wachtwoord'; sessie: TfaSessie }
  | { soort: 'lid'; lid: Teamlid };

export function mfaAfdwingen(): boolean {
  return afdwingenUitEnv(process.env.MFA_AFDWINGEN);
}

function teamVereist(): boolean {
  return process.env.TEAM_VEREIST !== '0';
}

export const STANDAARD_KLEUR = '#c8a97e';
const GENERIEK = new Set(['info', 'hallo', 'hello', 'contact', 'admin', 'mail', 'studio', 'office', 'team']);

/** Naam uit het e-mailadres (alleen als er nog geen profiel is). Bewust niet uit
 *  user_metadata: die kan een gebruiker zelf aanpassen. */
function naamUitEmail(email: string): string {
  const lokaal = (email.split('@')[0] || '').split(/[._+-]/)[0] || '';
  if (!lokaal || GENERIEK.has(lokaal.toLowerCase())) return 'Teamlid';
  return lokaal.charAt(0).toUpperCase() + lokaal.slice(1);
}

function initialenVan(naam: string): string {
  const delen = naam.trim().split(/\s+/).filter(Boolean);
  const i = (delen[0]?.[0] ?? 'S') + (delen[1]?.[0] ?? '');
  return i.toUpperCase().slice(0, 3);
}

export function maakProfiel(
  rij: { naam?: string | null; initialen?: string | null; kleur?: string | null } | null,
  email: string
): Profiel {
  const naam = (rij?.naam || '').trim() || naamUitEmail(email);
  const kleur = rij?.kleur && /^#[0-9a-f]{6}$/i.test(rij.kleur) ? rij.kleur.toLowerCase() : STANDAARD_KLEUR;
  return {
    naam,
    voornaam: naam === 'Teamlid' ? '' : naam.split(/\s+/)[0],
    initialen: (rij?.initialen || '').trim().toUpperCase().slice(0, 3) || initialenVan(naam),
    kleur
  };
}

interface ToegangRpc {
  lid?: boolean;
  rol?: string | null;
  aal?: string;
  heeft_factor?: boolean;
  tfa_rls?: boolean;
  versie?: number;
}

async function bepaalStatus(): Promise<TeamStatus> {
  const sb = await createClient();

  // Eén parallelle ronde: de sessie (Auth-server, met de 2FA-factoren) + lidmaatschappen en
  // profielen van het team + toegang_status() (0026: is de migratie er, staat de noodstop
  // aan?). Alles met hetzelfde token; RLS: een niet-lid ziet alleen zijn eigen lidmaatschap.
  // team_members met select('*'): zonder kolom boekhouding (0028 nog niet uitgevoerd) geen fout.
  const [userRes, lidRes, profielRes, toegangRes] = await Promise.all([
    sb.auth.getUser(),
    sb.from('team_members').select('*').limit(200),
    // select('*') i.p.v. losse kolommen: zo geeft een ontbrekende kolom welkom_klaar_op
    // (0022 nog niet uitgevoerd) geen fout en blijft het profiel gewoon leesbaar.
    sb.from('profiles').select('*').limit(200),
    sb.rpc('toegang_status')
  ]);
  const user = userRes.data.user;
  if (!user) return { soort: 'anoniem' };
  // Anonieme sign-ins (als die ooit aan zouden staan) zijn nooit teamlid.
  if (user.is_anonymous) return { soort: 'geen_toegang' };
  const userId = user.id;
  const email = user.email ?? '';

  // 2FA: factoren uit de (bij de Auth-server gecontroleerde) gebruiker; aal uit het token
  // van dezelfde sessie (lokaal gedecodeerd, geen extra rondgang).
  const factoren: Factor[] = (user.factors ?? [])
    .filter((f) => f.status === 'verified' && f.factor_type === 'totp')
    .map((f) => ({ id: f.id, naam: f.friendly_name || 'Authenticator-app', aangemaakt: f.created_at }));
  let aal: Aal = 'aal1';
  try {
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    aal = alsAal(data?.currentLevel);
  } catch {
    aal = 'aal1';
  }
  const toegang = toegangRes.error ? null : ((toegangRes.data ?? null) as ToegangRpc | null);
  if (toegangRes.error && !tabelOntbreekt(toegangRes.error)) logFout('[team] toegang_status', toegangRes.error);
  const tfa: TfaInfo = {
    factoren,
    aal,
    afdwingen: mfaAfdwingen(),
    migratie: Boolean(toegang && toegang.versie),
    rls: toegang?.tfa_rls !== false
  };

  if (lidRes.error) {
    if (tabelOntbreekt(lidRes.error) && !teamVereist()) {
      console.warn('[team] tabel team_members ontbreekt: overgangsmodus (voer supabase/UITVOEREN_0021_TEAM.sql uit).');
      const profiel = maakProfiel(null, email);
      return {
        soort: 'lid',
        lid: {
          userId,
          email,
          naam: profiel.naam,
          profiel,
          rol: 'lid',
          boekhouding: true,
          welkomKlaar: true,
          overgang: true,
          sb,
          bewijs: maakBewijs(),
          tfa
        }
      };
    }
    logFout('[team] lidmaatschap controleren mislukt', lidRes.error);
    return { soort: 'storing' };
  }

  const leden = (lidRes.data ?? []) as { user_id: string; actief: boolean; rol: string; boekhouding?: boolean | null }[];
  const rij = leden.find((l) => l.user_id === userId) ?? null;
  if (!rij || rij.actief !== true) return { soort: 'geen_toegang' };

  const profielen = profielRes.error ? null : ((profielRes.data ?? []) as (TeamRijen['profielen'][number] & { welkom_klaar_op?: string | null })[]);
  const profielRij = profielen?.find((p) => p.id === userId) ?? null;
  const profiel = maakProfiel(profielRij, email);
  const rol: Rol = rij.rol === 'eigenaar' ? 'eigenaar' : 'lid';
  const welkomKlaar = welkomKlaarVan(profielRij);
  const boekhouding = rol === 'eigenaar' || rij.boekhouding !== false;
  // Gezet door de admin (aanmaken of wachtwoord resetten); alleen de service-role kan
  // app_metadata wijzigen, en getUser() leest hem vers bij de Auth-server.
  const wachtwoordWijzigen = user.app_metadata?.wachtwoord_wijzigen === true;

  const stap = tfaStap({ heeftFactor: factoren.length > 0, aal, afdwingen: tfa.afdwingen, migratie: tfa.migratie });
  // Volgorde: eerst de 2FA-code (heeft hij al een factor), dan het nieuwe wachtwoord, dan
  // pas 2FA instellen (welkomstflow).
  if (wachtwoordWijzigen && stap !== 'uitdaging') {
    return {
      soort: 'wachtwoord',
      sessie: { userId, email, naam: profiel.naam, profiel, rol, welkomKlaar, sb, tfa, stap }
    };
  }
  if (stap !== 'ok') {
    return {
      soort: 'tfa',
      stap,
      sessie: { userId, email, naam: profiel.naam, profiel, rol, welkomKlaar, sb, tfa, stap }
    };
  }

  return {
    soort: 'lid',
    lid: {
      userId,
      email,
      naam: profiel.naam,
      profiel,
      rol,
      boekhouding,
      welkomKlaar,
      overgang: false,
      sb,
      bewijs: maakBewijs(),
      tfa,
      team: profielen ? { profielen, leden: leden.map((l) => ({ user_id: l.user_id, actief: l.actief === true })) } : undefined
    }
  };
}

/** De toegangsstatus van dit verzoek (binnen één render maar één keer opgehaald). */
export const huidigTeamlid = cache(bepaalStatus);

/** Voor API-routes en server actions: het teamlid, of null (geen sessie / geen lid / storing). */
export async function vereisTeamlid(): Promise<Teamlid | null> {
  const s = await huidigTeamlid();
  return s.soort === 'lid' ? s.lid : null;
}

/**
 * Voor pagina's en layouts: geeft het teamlid, of stuurt door naar /login (geen sessie)
 * of /geen-toegang (wel sessie, geen lid). Bij een storing een foutpagina.
 */
export async function vereisTeamlidPagina(next?: string): Promise<Teamlid> {
  const s = await huidigTeamlid();
  if (s.soort === 'lid') return s.lid;
  if (s.soort === 'anoniem') {
    const vervolg = next ? veiligVervolg(next) : '/';
    redirect(vervolg !== '/' ? `/login?next=${encodeURIComponent(vervolg)}` : '/login');
  }
  if (s.soort === 'geen_toegang') redirect('/geen-toegang');
  if (s.soort === 'tfa') redirect(tfaDoel(s, next));
  if (s.soort === 'wachtwoord') redirect('/nieuw-wachtwoord');
  throw new Error('De toegangscontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.');
}

/**
 * Voor de boekhoudschermen (bank, btw, activa, rapporten, instellingen, openstaand): alleen
 * met het vinkje Boekhouding (of als admin). Anders terug naar /boekhouding, waar je facturen,
 * klanten en bonnetjes wel ziet.
 */
export async function vereisBoekhouderPagina(next?: string): Promise<Teamlid> {
  const lid = await vereisTeamlidPagina(next);
  if (!lid.boekhouding) redirect('/boekhouding');
  return lid;
}

/** Waar een sessie heen moet die eerst iets met 2FA moet. */
export function tfaDoel(s: { stap: 'uitdaging' | 'instellen'; sessie: TfaSessie }, next?: string): string {
  const vervolg = next ? veiligVervolg(next) : '/';
  const q = vervolg !== '/' ? `?next=${encodeURIComponent(vervolg)}` : '';
  if (s.stap === 'uitdaging') return `/login/2fa${q}`;
  // Nieuw teamlid: 2FA is de eerste stap van de welkomstflow.
  if (!s.sessie.welkomKlaar) return '/welkom';
  return `/beveiliging/instellen${q}`;
}

/**
 * Voor de 2FA-pagina's en -routes: de sessie van een teamlid, ook als hij nog een code moet
 * invoeren of 2FA moet instellen. Geeft null zonder sessie of zonder lidmaatschap.
 */
export async function tfaSessie(): Promise<TfaSessie | null> {
  const s = await huidigTeamlid();
  if (s.soort === 'tfa') return s.sessie;
  if (s.soort === 'lid' && !s.lid.overgang) {
    const { lid } = s;
    return {
      userId: lid.userId,
      email: lid.email,
      naam: lid.naam,
      profiel: lid.profiel,
      rol: lid.rol,
      welkomKlaar: lid.welkomKlaar,
      sb: lid.sb,
      tfa: lid.tfa,
      stap: 'ok'
    };
  }
  return null;
}

/** Voor server actions: gooit bij geen toegang (de actie doet dan niets). */
export async function vereisTeamlidActie(): Promise<Teamlid> {
  const lid = await vereisTeamlid();
  if (!lid) throw new Error('Geen toegang.');
  return lid;
}

const GEEN_CACHE = { 'Cache-Control': 'private, no-store' } as const;

/** Het weigerantwoord voor een API-route bij een status die geen 'lid' is. */
export function weigering(s: Exclude<TeamStatus, { soort: 'lid' }>): NextResponse {
  if (s.soort === 'anoniem') {
    return NextResponse.json({ error: 'Niet ingelogd.', code: 'niet_ingelogd' }, { status: 401, headers: GEEN_CACHE });
  }
  if (s.soort === 'geen_toegang') {
    return NextResponse.json({ error: 'Geen toegang.', code: 'geen_toegang' }, { status: 403, headers: GEEN_CACHE });
  }
  if (s.soort === 'tfa') {
    return NextResponse.json(
      {
        error: s.stap === 'uitdaging' ? 'Vul eerst je code uit de authenticator-app in.' : 'Stel eerst tweestapsverificatie in.',
        code: 'tfa_nodig',
        stap: s.stap
      },
      { status: 401, headers: GEEN_CACHE }
    );
  }
  if (s.soort === 'wachtwoord') {
    return NextResponse.json({ error: 'Kies eerst een nieuw wachtwoord.', code: 'wachtwoord_nodig' }, { status: 401, headers: GEEN_CACHE });
  }
  return NextResponse.json(
    { error: 'De toegangscontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.', code: 'storing' },
    { status: 503, headers: GEEN_CACHE }
  );
}

export function herkomstWeigering(): NextResponse {
  return NextResponse.json({ error: 'Ongeldige herkomst.', code: 'herkomst' }, { status: 403, headers: GEEN_CACHE });
}

/**
 * Controle voor een API-route, als eerste stap: geeft het teamlid of een kant-en-klaar
 * weigerantwoord (401/403/503, of 403 bij een wijzigend verzoek van een ander domein).
 */
export async function controleerRoute(request: Request): Promise<{ lid: Teamlid } | { antwoord: NextResponse }> {
  const s = await huidigTeamlid();
  if (s.soort !== 'lid') return { antwoord: weigering(s) };
  if (isWijzigend(request.method) && !eigenHerkomst(request)) return { antwoord: herkomstWeigering() };
  return { lid: s.lid };
}

type RouteFn<C> = (request: Request, ctx: C, lid: Teamlid) => Promise<Response>;

/**
 * Wikkelt een route-handler: teamlidcontrole, herkomstcontrole bij wijzigende verzoeken,
 * het bewijs in de context (voor Storage-hulpjes) en een nette 500 zonder details.
 */
export function teamlidRoute<C>(fn: RouteFn<C>, opties: { label?: string } = {}) {
  return async (request: Request, ctx: C): Promise<Response> => {
    const c = await controleerRoute(request);
    if ('antwoord' in c) return c.antwoord;
    try {
      return await metTeamlid(c.lid, () => fn(request, ctx, c.lid));
    } catch (e) {
      logFout(`[${opties.label ?? 'api'}]`, e);
      return NextResponse.json({ error: 'Er ging iets mis. Probeer het opnieuw.' }, { status: 500, headers: GEEN_CACHE });
    }
  };
}

/**
 * Voor routes die alleen de eigenaar mag gebruiken (beveiliging, audit-log, back-ups): naast
 * de gewone teamcheck rol 'eigenaar' én een sessie op aal2 (2FA), ook als afdwingen uit staat.
 */
export function eigenaarRoute<C>(fn: RouteFn<C>, opties: { label?: string } = {}) {
  return teamlidRoute<C>(async (request, ctx, lid) => {
    if (lid.rol !== 'eigenaar') {
      return NextResponse.json({ error: 'Alleen voor de eigenaar.', code: 'geen_eigenaar' }, { status: 403, headers: GEEN_CACHE });
    }
    if (lid.tfa.aal !== 'aal2') {
      return NextResponse.json(
        { error: 'Stel eerst tweestapsverificatie in en log opnieuw in met je code.', code: 'aal2_nodig' },
        { status: 403, headers: GEEN_CACHE }
      );
    }
    return fn(request, ctx, lid);
  }, opties);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
