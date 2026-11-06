'use client';

import { useEffect, useRef, useState } from 'react';
import { KLEUREN } from '@/lib/google-agenda/kern';
import type { GoogleAgenda, GoogleStatus } from '@/lib/google-agenda/types';

// Welke agenda's je ziet. Twee plekken, zoals in Google Agenda zelf:
//   - AgendaChips: een rij gekleurde knopjes boven de agenda (Studio Levant en je eigen
//     Google-agenda's): één klik = tonen of verbergen. Dit is ook de legenda van de kleuren.
//   - AgendaBeheer: het venster achter de knop "Agenda's": alle agenda's per Google-account
//     (ook feestdagen, gedeelde agenda's), kleur kiezen, "ook in je Apple-agenda",
//     account toevoegen, verversen of ontkoppelen.

export const EIGEN_KLEUR = '#c8a97e';

export type AgendaWijziging = { zichtbaar?: boolean; inFeed?: boolean; kleur?: string };

/** In de rij met knopjes: je eigen (schrijfbare) agenda's en alles wat je aanzette. */
const inRij = (a: GoogleAgenda) => a.zichtbaar || a.schrijfbaar;

export function AgendaChips({
  status,
  eigenZichtbaar,
  onEigen,
  onWijzig
}: {
  status: GoogleStatus;
  eigenZichtbaar: boolean;
  onEigen: (zichtbaar: boolean) => void;
  onWijzig: (agendaId: string, w: AgendaWijziging) => void;
}) {
  const agendas = status.accounts.flatMap((a) => a.agendas.filter(inRij));
  if (!agendas.length) return null;
  return (
    <div className="ag-kal-rij" role="group" aria-label="Agenda's tonen">
      <Chip naam="Studio Levant" kleur={EIGEN_KLEUR} aan={eigenZichtbaar} onClick={() => onEigen(!eigenZichtbaar)} />
      {status.accounts.map((acc) =>
        acc.agendas.filter(inRij).map((a) => (
          <Chip
            key={a.id}
            naam={a.naam}
            titel={`${a.naam} · ${acc.email}`}
            kleur={a.kleur}
            aan={a.zichtbaar}
            fout={!!acc.fout}
            onClick={() => onWijzig(a.id, { zichtbaar: !a.zichtbaar })}
          />
        ))
      )}
    </div>
  );
}

function Chip({
  naam,
  titel,
  kleur,
  aan,
  fout,
  onClick
}: {
  naam: string;
  titel?: string;
  kleur: string;
  aan: boolean;
  fout?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ag-kal-chip${aan ? ' is-aan' : ''}${fout ? ' is-fout' : ''}`}
      style={{ '--ag-kleur': kleur } as React.CSSProperties}
      aria-pressed={aan}
      title={`${titel ?? naam} — ${aan ? 'klik om te verbergen' : 'klik om te tonen'}`}
      onClick={onClick}
    >
      <span className="ag-kal-stip" aria-hidden="true" />
      <span className="ag-kal-chip-naam">{naam}</span>
    </button>
  );
}

export function AgendaBeheer({
  status,
  eigenZichtbaar,
  fouten,
  open,
  onOpen,
  onEigen,
  onWijzig,
  onVernieuw,
  onOntkoppel
}: {
  status: GoogleStatus | null;
  eigenZichtbaar: boolean;
  fouten: { accountId: string; melding: string }[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onEigen: (zichtbaar: boolean) => void;
  onWijzig: (agendaId: string, w: AgendaWijziging) => void;
  onVernieuw: (accountId: string) => Promise<void>;
  onOntkoppel: (accountId: string) => Promise<void>;
}) {
  const doos = useRef<HTMLDivElement>(null);
  const knop = useRef<HTMLButtonElement>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);
  const [zekerWeg, setZekerWeg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function buiten(e: PointerEvent) {
      const t = e.target as Node;
      if (doos.current && !doos.current.contains(t) && !knop.current?.contains(t)) onOpen(false);
    }
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpen(false);
        knop.current?.focus();
      }
    }
    const t = setTimeout(() => document.addEventListener('pointerdown', buiten), 0);
    document.addEventListener('keydown', toets);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', buiten);
      document.removeEventListener('keydown', toets);
    };
  }, [open, onOpen]);

  async function doe(sleutel: string, fn: () => Promise<void>) {
    setBezig(sleutel);
    try {
      await fn();
    } finally {
      setBezig(null);
    }
  }

  const aantal = status?.accounts.length ?? 0;

  return (
    <div className="ag-kal">
      <button
        ref={knop}
        type="button"
        className="db-knop ag-kal-knop"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onOpen(!open)}
        title="Agenda's tonen, kleuren en Google Agenda koppelen"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>Agenda&rsquo;s</span>
        {fouten.length > 0 && <span className="ag-kal-let" aria-label="Er is iets mis met een koppeling" />}
      </button>
      {open && (
        <div ref={doos} className="ag-popover ag-kal-venster" role="dialog" aria-label="Agenda's">
          <p className="db-label ag-popover-titel">Agenda&rsquo;s</p>

          <ul className="ag-kal-lijst">
            <li className="ag-kal-item">
              <label className="ag-kal-regel">
                <input type="checkbox" checked={eigenZichtbaar} onChange={(e) => onEigen(e.target.checked)} />
                <span className="ag-kal-stip" style={{ '--ag-kleur': EIGEN_KLEUR } as React.CSSProperties} aria-hidden="true" />
                <span className="ag-kal-naam">
                  Studio Levant
                  <small>Afspraken uit het dashboard</small>
                </span>
              </label>
            </li>
          </ul>

          {status && !status.tabellen ? (
            <p className="ag-kal-uitleg">
              Google Agenda koppelen kan zodra migratie 0035 is uitgevoerd (<code>supabase/UITVOEREN_0035.sql</code> in de Supabase SQL Editor).
            </p>
          ) : status && !status.ingericht ? (
            <p className="ag-kal-uitleg">Google Agenda is nog niet ingericht op de server (GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET).</p>
          ) : (
            status?.accounts.map((acc) => {
              const melding = acc.fout ? 'De toegang is verlopen of ingetrokken.' : fouten.find((f) => f.accountId === acc.id)?.melding;
              return (
                <section key={acc.id} className="ag-kal-account">
                  <header className="ag-kal-account-kop">
                    <span className="ag-kal-account-naam" title={acc.email}>
                      {acc.email}
                    </span>
                    {zekerWeg === acc.id ? (
                      <span className="ag-kal-account-acties">
                        <button
                          type="button"
                          className="ag-link-knop ag-link-gevaar"
                          disabled={bezig === acc.id}
                          onClick={() => void doe(acc.id, () => onOntkoppel(acc.id)).then(() => setZekerWeg(null))}
                        >
                          Ja, ontkoppelen
                        </button>
                        <button type="button" className="ag-link-knop" onClick={() => setZekerWeg(null)}>
                          Nee
                        </button>
                      </span>
                    ) : (
                      <span className="ag-kal-account-acties">
                        {!acc.fout && (
                          <button
                            type="button"
                            className="ag-link-knop"
                            disabled={bezig === acc.id}
                            title="Nieuwe of verwijderde agenda's uit Google ophalen"
                            onClick={() => void doe(acc.id, () => onVernieuw(acc.id))}
                          >
                            {bezig === acc.id ? 'Bezig…' : 'Vernieuwen'}
                          </button>
                        )}
                        <button type="button" className="ag-link-knop" onClick={() => setZekerWeg(acc.id)}>
                          Ontkoppelen
                        </button>
                      </span>
                    )}
                  </header>
                  {melding && (
                    <div className="ag-kal-melding" role="alert">
                      <span>{melding}</span>
                      {acc.fout && <KoppelKnop tekst="Opnieuw koppelen" klein />}
                    </div>
                  )}
                  <ul className="ag-kal-lijst">
                    {acc.agendas.map((a) => (
                      <li key={a.id} className="ag-kal-item">
                        <div className="ag-kal-regel-rij">
                          <label className="ag-kal-regel">
                            <input type="checkbox" checked={a.zichtbaar} onChange={(e) => onWijzig(a.id, { zichtbaar: e.target.checked })} />
                            <span className="ag-kal-stip" style={{ '--ag-kleur': a.kleur } as React.CSSProperties} aria-hidden="true" />
                            <span className="ag-kal-naam">
                              {a.naam}
                              {!a.schrijfbaar && <small>Alleen lezen</small>}
                            </span>
                          </label>
                          <button
                            type="button"
                            className="ag-icoonknop ag-kal-meer"
                            aria-expanded={details === a.id}
                            aria-label={`Kleur en instellingen van ${a.naam}`}
                            title="Kleur en instellingen"
                            onClick={() => setDetails(details === a.id ? null : a.id)}
                          >
                            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                              <circle cx="6" cy="12" r="1.4" fill="currentColor" />
                              <circle cx="12" cy="12" r="1.4" fill="currentColor" />
                              <circle cx="18" cy="12" r="1.4" fill="currentColor" />
                            </svg>
                          </button>
                        </div>
                        {details === a.id && (
                          <div className="ag-kal-details">
                            <div className="ag-kal-kleuren" role="radiogroup" aria-label={`Kleur van ${a.naam}`}>
                              {KLEUREN.map((k) => (
                                <button
                                  key={k.kleur}
                                  type="button"
                                  role="radio"
                                  aria-checked={a.kleur === k.kleur}
                                  aria-label={k.naam}
                                  title={k.naam}
                                  className="ag-kal-kleur"
                                  style={{ '--ag-kleur': k.kleur } as React.CSSProperties}
                                  onClick={() => onWijzig(a.id, { kleur: k.kleur })}
                                />
                              ))}
                            </div>
                            <label className="ag-schakel ag-kal-feed">
                              <input type="checkbox" checked={a.inFeed} onChange={(e) => onWijzig(a.id, { inFeed: e.target.checked })} />
                              <span>
                                Ook in je agenda-link
                                <small>Apple Agenda op je iPhone en Mac (zet uit als die deze Google-agenda al toont)</small>
                              </span>
                            </label>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}

          {status?.tabellen && status.ingericht && (
            <div className="ag-kal-voet">
              <KoppelKnop tekst={aantal ? '+ Nog een Google-account' : 'Google Agenda koppelen'} primair={!aantal} />
              {!aantal && (
                <p className="ag-kal-uitleg">
                  Je afspraken uit Google (met Meet-links, beschrijving en gasten) verschijnen hier in hun eigen kleur. Je kunt ze
                  hier ook maken, wijzigen en verwijderen. Alleen jij ziet ze.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Formulier-knop naar Google (POST, zodat de koppeling nooit via een link te starten is). */
function KoppelKnop({ tekst, primair, klein }: { tekst: string; primair?: boolean; klein?: boolean }) {
  return (
    <form method="post" action="/api/google-agenda/koppelen" className="ag-kal-koppel">
      <button type="submit" className={klein ? 'ag-link-knop' : `db-knop${primair ? ' db-knop-primair' : ''}`}>
        {!klein && (
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z"
              fill="currentColor"
              opacity=".9"
            />
            <path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" fill="currentColor" opacity=".7" />
            <path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z" fill="currentColor" opacity=".5" />
            <path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9Z" fill="currentColor" opacity=".8" />
          </svg>
        )}
        {tekst}
      </button>
    </form>
  );
}
