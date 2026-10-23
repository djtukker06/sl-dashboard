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
import { eigenHerkomst, isWijzigend } from './herkomst';

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
// Overgangsmodus: zolang migratie 0021 niet is uitgevoerd (tabel team_members bestaat
// nog niet) geldt elke ingelogde, niet-anonieme gebruiker als lid — precies de
// beveiliging van vóór 0021 — en toont de shell een banner. Elke andere fout bij het
// controleren laat NIEMAND door (fail closed).

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
  /** false = de welkomstflow (/welkom) nog doorlopen. true als hij klaar is, en ook zonder
   *  kolom profiles.welkom_klaar_op (migratie 0022 nog niet uitgevoerd) of zonder profiel. */
  welkomKlaar: boolean;
  /** true zolang migratie 0021 niet is uitgevoerd (zie boven). */
  overgang: boolean;
  /** Gebruikerscliënt (RLS geldt). */
  sb: SupabaseClient;
  bewijs: TeamlidBewijs;
  /** De profielen en lidmaatschappen van het team, al opgehaald bij de controle (voor
   *  lib/team/profielen.ts). Alleen wat RLS dit teamlid laat zien. */
  team?: TeamRijen;
}

export interface TeamRijen {
  profielen: { id: string; naam?: string | null; initialen?: string | null; kleur?: string | null }[];
  leden: { user_id: string; actief: boolean }[];
}

export type TeamStatus =
  | { soort: 'anoniem' }
  | { soort: 'geen_toegang' }
  | { soort: 'storing' }
  | { soort: 'lid'; lid: Teamlid };

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

async function bepaalStatus(): Promise<TeamStatus> {
  const sb = await createClient();

  // Eén parallelle ronde: de sessie (Auth-server) + lidmaatschappen en profielen van het
  // team (database, met hetzelfde token; RLS: een niet-lid ziet alleen zijn eigen
  // lidmaatschap en geen profielen).
  const [userRes, lidRes, profielRes] = await Promise.all([
    sb.auth.getUser(),
    sb.from('team_members').select('user_id, actief, rol').limit(200),
    // select('*') i.p.v. losse kolommen: zo geeft een ontbrekende kolom welkom_klaar_op
    // (0022 nog niet uitgevoerd) geen fout en blijft het profiel gewoon leesbaar.
    sb.from('profiles').select('*').limit(200)
  ]);
  const user = userRes.data.user;
  if (!user) return { soort: 'anoniem' };
  // Anonieme sign-ins (als die ooit aan zouden staan) zijn nooit teamlid.
  if (user.is_anonymous) return { soort: 'geen_toegang' };
  const userId = user.id;
  const email = user.email ?? '';

  if (lidRes.error) {
    if (tabelOntbreekt(lidRes.error)) {
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
          welkomKlaar: true,
          overgang: true,
          sb,
          bewijs: maakBewijs()
        }
      };
    }
    console.error('[team] lidmaatschap controleren mislukt', lidRes.error.code ?? '', lidRes.error.message);
    return { soort: 'storing' };
  }

  const leden = (lidRes.data ?? []) as { user_id: string; actief: boolean; rol: string }[];
  const rij = leden.find((l) => l.user_id === userId) ?? null;
  if (!rij || rij.actief !== true) return { soort: 'geen_toegang' };

  const profielen = profielRes.error ? null : ((profielRes.data ?? []) as (TeamRijen['profielen'][number] & { welkom_klaar_op?: string | null })[]);
  const profielRij = profielen?.find((p) => p.id === userId) ?? null;
  const profiel = maakProfiel(profielRij, email);
  return {
    soort: 'lid',
    lid: {
      userId,
      email,
      naam: profiel.naam,
      profiel,
      rol: rij.rol === 'eigenaar' ? 'eigenaar' : 'lid',
      welkomKlaar: welkomKlaarVan(profielRij),
      overgang: false,
      sb,
      bewijs: maakBewijs(),
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
  throw new Error('De toegangscontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.');
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
      console.error(`[${opties.label ?? 'api'}]`, e);
      return NextResponse.json({ error: 'Er ging iets mis. Probeer het opnieuw.' }, { status: 500, headers: GEEN_CACHE });
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
