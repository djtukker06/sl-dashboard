'use client';

import { api } from './client';
import type { Afspraak, AfspraakInvoer } from './types';
import type { AgendaWijziging, BronStatus, ExternAccount, ExternBereik, ExternBron, ExternStatus } from './extern-types';
import { googleApi, isGoogleId } from '@/lib/google-agenda/client';
import type { GoogleStatus } from '@/lib/google-agenda/types';
import { isAppleId } from '@/lib/apple-agenda/id-kern';

// Browser-kant van de gekoppelde agenda's: Google (app/api/google-agenda, 0035) en Apple/iCloud
// (app/api/apple-agenda, 0040). Eén ingang voor de agenda, zodat de schermen niet hoeven te
// weten waar een afspraak vandaan komt: id's "g.…" zijn van Google, "a.…" van Apple.

const body = (b: unknown) => JSON.stringify(b);
const enc = (s: string) => encodeURIComponent(s);

function vanGoogle(s: GoogleStatus): { status: BronStatus; accounts: ExternAccount[] } {
  return {
    status: { ingericht: s.ingericht, tabellen: s.tabellen },
    accounts: s.accounts.map((a) => ({ ...a, bron: 'google' as const, agendas: a.agendas.map((g) => ({ ...g, bron: 'google' as const })) }))
  };
}

/** Status van één bron samenvoegen met de huidige status (de andere bron blijft staan). */
export function metBron(huidig: ExternStatus | null, bron: ExternBron, nieuw: ExternStatus | GoogleStatus): ExternStatus {
  const deel =
    bron === 'google'
      ? vanGoogle(nieuw as GoogleStatus)
      : { status: (nieuw as ExternStatus).apple ?? { ingericht: false, tabellen: false }, accounts: (nieuw as ExternStatus).accounts };
  const anders = (huidig?.accounts ?? []).filter((a) => a.bron !== bron);
  const accounts = bron === 'google' ? [...deel.accounts, ...anders] : [...anders, ...deel.accounts];
  return {
    google: bron === 'google' ? deel.status : (huidig?.google ?? null),
    apple: bron === 'apple' ? deel.status : (huidig?.apple ?? null),
    accounts
  };
}

const appleBereik = (van: string, tot: string) => api<ExternBereik>(`/api/apple-agenda/afspraken?van=${van}&tot=${tot}`);

export const externApi = {
  /** Google en Apple tegelijk; werkt de een niet, dan komt de ander toch. */
  bereik: async (van: string, tot: string): Promise<ExternBereik> => {
    const [g, a] = await Promise.allSettled([googleApi.bereik(van, tot), appleBereik(van, tot)]);
    if (g.status === 'rejected' && a.status === 'rejected') throw g.reason;
    let status: ExternStatus = { google: null, apple: null, accounts: [] };
    const events: Afspraak[] = [];
    const fouten: ExternBereik['fouten'] = [];
    if (g.status === 'fulfilled') {
      status = metBron(status, 'google', g.value.status);
      events.push(...g.value.events);
      fouten.push(...g.value.fouten);
    }
    if (a.status === 'fulfilled') {
      status = metBron(status, 'apple', a.value.status);
      events.push(...a.value.events);
      fouten.push(...a.value.fouten);
    }
    return { status, events, fouten };
  },
  afspraak: (id: string) => (isGoogleId(id) ? googleApi.afspraak(id) : api<{ event: Afspraak }>(`/api/apple-agenda/afspraken/${enc(id)}`)),
  maak: (bron: ExternBron, agendaId: string, b: AfspraakInvoer) =>
    bron === 'google'
      ? googleApi.maak(agendaId, b)
      : api<{ event: Afspraak }>('/api/apple-agenda/afspraken', { method: 'POST', body: body({ ...b, agendaId }) }),
  wijzig: (id: string, b: AfspraakInvoer) =>
    isGoogleId(id) ? googleApi.wijzig(id, b) : api<{ event: Afspraak }>(`/api/apple-agenda/afspraken/${enc(id)}`, { method: 'PATCH', body: body(b) }),
  verwijder: (id: string, toepassen?: 'deze' | 'reeks') =>
    isGoogleId(id)
      ? googleApi.verwijder(id, toepassen)
      : api<{ ok: true }>(`/api/apple-agenda/afspraken/${enc(id)}${toepassen ? `?toepassen=${toepassen}` : ''}`, { method: 'DELETE' }),
  /** Geeft de status van die bron; voeg samen met metBron(). */
  agenda: (bron: ExternBron, agendaId: string, w: AgendaWijziging): Promise<ExternStatus | GoogleStatus> =>
    bron === 'google'
      ? googleApi.agenda(agendaId, w)
      : api<ExternStatus>(`/api/apple-agenda/agendas/${enc(agendaId)}`, { method: 'PATCH', body: body({ zichtbaar: w.zichtbaar, kleur: w.kleur }) }),
  vernieuw: (bron: ExternBron, accountId: string): Promise<ExternStatus | GoogleStatus> =>
    bron === 'google' ? googleApi.vernieuw(accountId) : api<ExternStatus>(`/api/apple-agenda/accounts/${enc(accountId)}`, { method: 'POST' }),
  ontkoppel: (bron: ExternBron, accountId: string): Promise<ExternStatus | GoogleStatus> =>
    bron === 'google' ? googleApi.ontkoppel(accountId) : api<ExternStatus>(`/api/apple-agenda/accounts/${enc(accountId)}`, { method: 'DELETE' }),
  koppelApple: (appleId: string, wachtwoord: string) => api<ExternStatus>('/api/apple-agenda', { method: 'POST', body: body({ appleId, wachtwoord }) })
};

/** Komt deze afspraak uit een gekoppelde agenda? */
export const isExternId = (s: string | null | undefined) => isGoogleId(s) || isAppleId(s);
