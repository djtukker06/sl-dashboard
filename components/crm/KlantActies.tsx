'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import { plusDagen } from '@/lib/agenda/datum';
import type { KlantInvoer } from '@/lib/crm/types';
import { useToast } from '@/components/agenda/Toast';
import { useTeam } from '@/components/team/TeamProvider';
import { CrmDialoog, crmApi } from './CrmDialoog';
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

/**
 * Een lead afronden met één klik: "Gewonnen" (→ actief, optioneel meteen een project) of
 * "Afgewezen" (→ afgerond, met "Ongedaan maken").
 */
export function LeadActies({
  klant,
  opvolging,
  klein = false
}: {
  klant: { id: string; naam: string; opvolgenOp: string | null };
  /** Migratie 0025 aanwezig (dan ook de opvolgdatum wissen bij afwijzen). */
  opvolging: boolean;
  klein?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const wijzig = useKlantWijzigen();
  const { mijnId } = useTeam();
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState('');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');

  async function afwijzen() {
    const ok = await wijzig(
      klant.id,
      { status: 'afgerond', ...(opvolging ? { opvolgenOp: null } : {}) },
      `${klant.naam} staat nu onder Afgerond`,
      { label: 'Ongedaan maken', onClick: () => void wijzig(klant.id, { status: 'lead', ...(opvolging ? { opvolgenOp: klant.opvolgenOp } : {}) }, 'Terug bij de leads') }
    );
    return ok;
  }

  async function winnen(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout('');
    try {
      await crmApi(`/api/klanten/${klant.id}`, 'PATCH', { status: 'actief', ...(opvolging ? { opvolgenOp: null } : {}) });
      const naam = project.trim();
      if (naam) {
        const { project: p } = await agendaApi.maakProject({ naam, klantId: klant.id, status: 'voorbereiding', deadline: null, eigenaren: [mijnId] });
        toast(`${klant.naam} is klant · project ‘${naam}’ aangemaakt`);
        router.push(`/projecten/${p.id}`);
        return;
      }
      toast(`${klant.naam} is nu een actieve klant`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Niet gelukt.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <span className="kp-leadacties">
      <button
        type="button"
        className={`db-knop kp-knop-gewonnen${klein ? ' db-knop-klein' : ''}`}
        onClick={() => {
          setProject('');
          setFout('');
          setOpen(true);
        }}
        title="Lead gewonnen: wordt een actieve klant"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Gewonnen
      </button>
      <button type="button" className={`db-knop kp-knop-stil${klein ? ' db-knop-klein' : ''}`} onClick={() => void afwijzen()} title="Lead afgewezen: naar Afgerond">
        Afgewezen
      </button>
      {open && (
        <CrmDialoog titel="Lead gewonnen" onSluit={() => setOpen(false)}>
          <form className="kp-form" onSubmit={winnen} noValidate>
            <p className="kp-uitleg">
              <strong>{klant.naam}</strong> wordt een actieve klant. Meteen een project aanmaken? Laat het veld leeg als dat later komt.
            </p>
            <label className="ag-label">
              Project (optioneel)
              <input className="ag-veld" value={project} maxLength={120} placeholder="Bijv. Huisstijl 2027" onChange={(e) => setProject(e.target.value)} />
            </label>
            {fout && (
              <p className="ag-fout" role="alert">
                {fout}
              </p>
            )}
            <div className="kp-form-acties">
              <button type="button" className="db-knop" onClick={() => setOpen(false)}>
                Annuleren
              </button>
              <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
                {bezig ? 'Bezig…' : project.trim() ? 'Klant + project maken' : 'Maak actieve klant'}
              </button>
            </div>
          </form>
        </CrmDialoog>
      )}
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
