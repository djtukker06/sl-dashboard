'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { plusDagen } from '@/lib/agenda/datum';
import type { KlantInvoer, KlantStatus } from '@/lib/crm/types';
import { useToast } from '@/components/agenda/Toast';
import { crmApi } from './CrmDialoog';
import { OpvolgBadge } from './StatusPil';

/** Klant wijzigen (PATCH) met een foutmelding als toast; geeft true bij succes. */
export function useKlantWijzigen() {
  const router = useRouter();
  const toast = useToast();
  return async (id: string, body: KlantInvoer, melding?: string, actie?: { label: string; onClick: () => void }): Promise<boolean> => {
    try {
      await crmApi(`/api/klanten/${id}`, 'PATCH', body);
      if (melding) toast(melding, actie ? { actie } : undefined);
      router.refresh();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Niet gelukt.', { fout: true });
      return false;
    }
  };
}

/**
 * "Volgende stap" + "opvolgen op" (migratie 0025), direct bewerkbaar: tekst slaat op bij
 * Enter of verlaten, de datum meteen. `snel` toont knoppen Morgen / Volgende week / Wissen.
 */
export function OpvolgVelden({
  klantId,
  klantNaam,
  volgendeStap,
  opvolgenOp,
  vandaag,
  snel = false
}: {
  klantId: string;
  klantNaam: string;
  volgendeStap: string;
  opvolgenOp: string | null;
  vandaag: string;
  snel?: boolean;
}) {
  const wijzig = useKlantWijzigen();
  const [stap, setStap] = useState(volgendeStap);
  const [datum, setDatum] = useState(opvolgenOp ?? '');

  async function bewaarStap() {
    const t = stap.replace(/\s+/g, ' ').trim();
    if (t === volgendeStap) return;
    if (!(await wijzig(klantId, { volgendeStap: t }))) setStap(volgendeStap);
  }
  async function bewaarDatum(d: string) {
    const oud = datum;
    setDatum(d);
    if (!(await wijzig(klantId, { opvolgenOp: d || null }))) setDatum(oud);
  }

  return (
    <div className={`kp-opvolg${snel ? ' kp-opvolg-ruim' : ''}`}>
      <input
        className="ag-veld kp-opvolg-stap"
        value={stap}
        maxLength={200}
        placeholder="Volgende stap, bv. offerte nabellen"
        aria-label={`Volgende stap voor ${klantNaam}`}
        onChange={(e) => setStap(e.target.value)}
        onBlur={() => void bewaarStap()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setStap(volgendeStap);
            e.currentTarget.blur();
          }
        }}
      />
      <span className="kp-opvolg-datum">
        <input
          className="ag-veld"
          type="date"
          value={datum}
          aria-label={`Opvolgen op (${klantNaam})`}
          onChange={(e) => void bewaarDatum(e.target.value)}
        />
        <OpvolgBadge datum={datum || null} vandaag={vandaag} />
      </span>
      {snel && (
        <span className="kp-opvolg-snel" role="group" aria-label="Snel een datum kiezen">
          <button type="button" className="kp-chip" onClick={() => void bewaarDatum(plusDagen(vandaag, 1))}>
            Morgen
          </button>
          <button type="button" className="kp-chip" onClick={() => void bewaarDatum(plusDagen(vandaag, 7))}>
            Over een week
          </button>
          <button type="button" className="kp-chip" onClick={() => void bewaarDatum(plusDagen(vandaag, 14))}>
            Over 2 weken
          </button>
          {datum && (
            <button type="button" className="kp-chip" onClick={() => void bewaarDatum('')}>
              Wissen
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** Onder welke tab een status staat (voor "staat weer onder …" na ongedaan maken). */
const TAB_NAAM: Record<KlantStatus, string> = { koud: 'Op de radar', lead: 'Leads', actief: 'Actief', afgerond: 'Afgerond' };

/**
 * Knoppen bij een lead of iets op de radar, elk met één klik en "Ongedaan maken" in de
 * melding: "Omzetten naar klant" (→ actief; er is akkoord), "Op de radar" ↔ "Naar leads",
 * en "Afgewezen" (→ afgerond). `onStatus` laat de lijst meteen meeschuiven (optimistisch);
 * mislukt het opslaan, dan gaat de klant terug. Bij klant/afgerond wordt de opvolgdatum
 * gewist (zoals voorheen bij "Gewonnen"), en bij ongedaan maken teruggezet.
 */
export function LeadActies({
  klant,
  opvolging,
  klein = false,
  onStatus
}: {
  klant: { id: string; naam: string; status: KlantStatus; opvolgenOp: string | null };
  /** Migratie 0025 aanwezig (dan ook de opvolgdatum wissen/terugzetten). */
  opvolging: boolean;
  klein?: boolean;
  /** Direct in de lijst bijwerken (de server volgt met router.refresh). */
  onStatus?: (id: string, status: KlantStatus) => void;
}) {
  const wijzig = useKlantWijzigen();
  const [bezig, setBezig] = useState(false);
  const knop = `db-knop${klein ? ' db-knop-klein' : ''}`;

  async function zet(nieuw: KlantStatus, melding: string) {
    if (bezig) return;
    const oud = klant.status;
    const oudeDatum = klant.opvolgenOp;
    const wisDatum = opvolging && (nieuw === 'actief' || nieuw === 'afgerond') && !!oudeDatum;
    setBezig(true);
    onStatus?.(klant.id, nieuw);
    const ok = await wijzig(klant.id, { status: nieuw, ...(wisDatum ? { opvolgenOp: null } : {}) }, melding, {
      label: 'Ongedaan maken',
      onClick: () => {
        onStatus?.(klant.id, oud);
        void wijzig(klant.id, { status: oud, ...(wisDatum ? { opvolgenOp: oudeDatum } : {}) }, `${klant.naam} staat weer onder ${TAB_NAAM[oud]}`).then((terug) => {
          if (!terug) onStatus?.(klant.id, nieuw);
        });
      }
    });
    if (!ok) onStatus?.(klant.id, oud);
    setBezig(false);
  }

  return (
    <span className="kp-leadacties">
      <button
        type="button"
        className={`${knop} kp-knop-gewonnen`}
        disabled={bezig}
        onClick={() => void zet('actief', `${klant.naam} is nu een klant`)}
        title="Er is akkoord: wordt een actieve klant (staat daarna onder Actief)"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Omzetten naar klant
      </button>
      {klant.status === 'koud' ? (
        <button
          type="button"
          className={`${knop} kp-knop-stil`}
          disabled={bezig}
          onClick={() => void zet('lead', `${klant.naam} staat nu bij de leads`)}
          title="We gaan ze benaderen: naar Leads (met opvolgen)"
        >
          Naar leads
        </button>
      ) : (
        <button
          type="button"
          className={`${knop} kp-knop-stil`}
          disabled={bezig}
          onClick={() => void zet('koud', `${klant.naam} staat nu op de radar`)}
          title="Nu niet benaderen, wel onthouden: naar Op de radar (telt niet mee bij Opvolgen)"
        >
          Op de radar
        </button>
      )}
      <button
        type="button"
        className={`${knop} kp-knop-stil`}
        disabled={bezig}
        onClick={() => void zet('afgerond', `${klant.naam} staat nu onder Afgerond`)}
        title="Wordt niets: naar Afgerond (blijft vindbaar)"
      >
        Afgewezen
      </button>
    </span>
  );
}

/** Mailen (eigen mail-module) en bellen in de kop van de klantpagina. */
export function ContactActies({ email, telefoon }: { email: string; telefoon: string }) {
  if (!email && !telefoon) return null;
  return (
    <span className="kp-contactacties">
      {email && (
        <a className="db-knop" href={`/mail?nieuw=1&aan=${encodeURIComponent(email)}`} title={`Mail naar ${email}`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="2" y="3.5" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2.5 4.5L8 9l5.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          Mailen
        </a>
      )}
      {telefoon && (
        <a className="db-knop" href={`tel:${telefoon.replace(/[^0-9+]/g, '')}`} title={`Bel ${telefoon}`}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M5.2 2.5l1.5 3-1.3 1.2a8 8 0 003.9 3.9l1.2-1.3 3 1.5-.5 2.2a1.2 1.2 0 01-1.2.9A10.5 10.5 0 012.1 4a1.2 1.2 0 01.9-1.2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
          Bellen
        </a>
      )}
    </span>
  );
}
