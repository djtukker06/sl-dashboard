'use client';

import { api } from '@/lib/agenda/client';
import type { Afspraak, AfspraakInvoer } from '@/lib/agenda/types';
import type { GoogleBereik, GoogleStatus } from './types';

// Browser-kant van de Google Agenda-koppeling (app/api/google-agenda).

const body = (b: unknown) => JSON.stringify(b);
const id = (s: string) => encodeURIComponent(s);

export const googleApi = {
  bereik: (van: string, tot: string) => api<GoogleBereik>(`/api/google-agenda/afspraken?van=${van}&tot=${tot}`),
  status: () => api<GoogleStatus>('/api/google-agenda'),
  afspraak: (afspraakId: string) => api<{ event: Afspraak }>(`/api/google-agenda/afspraken/${id(afspraakId)}`),
  maak: (agendaId: string, b: AfspraakInvoer) =>
    api<{ event: Afspraak }>('/api/google-agenda/afspraken', { method: 'POST', body: body({ ...b, agendaId }) }),
  wijzig: (afspraakId: string, b: AfspraakInvoer) =>
    api<{ event: Afspraak }>(`/api/google-agenda/afspraken/${id(afspraakId)}`, { method: 'PATCH', body: body(b) }),
  verwijder: (afspraakId: string, toepassen?: 'deze' | 'reeks') =>
    api<{ ok: true }>(`/api/google-agenda/afspraken/${id(afspraakId)}${toepassen ? `?toepassen=${toepassen}` : ''}`, { method: 'DELETE' }),
  agenda: (agendaId: string, b: { zichtbaar?: boolean; inFeed?: boolean; kleur?: string }) =>
    api<GoogleStatus>(`/api/google-agenda/agendas/${id(agendaId)}`, { method: 'PATCH', body: body(b) }),
  vernieuw: (accountId: string) => api<GoogleStatus>(`/api/google-agenda/accounts/${id(accountId)}`, { method: 'POST' }),
  ontkoppel: (accountId: string) => api<GoogleStatus>(`/api/google-agenda/accounts/${id(accountId)}`, { method: 'DELETE' })
};

/** Is dit een afspraak uit Google ("g.<agenda>.<event>")? */
export const isGoogleId = (s: string | null | undefined) => typeof s === 'string' && s.startsWith('g.');
