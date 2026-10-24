'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatEuro } from '@/lib/format';
import { korteDatum } from '@/lib/dashboard/tijd';
import { KLANT_STATUS_LABEL, type KlantRegel, type KlantStatus } from '@/lib/crm/types';
import {
  SORTERING_LABEL,
  geledenKort,
  klantPast,
  opvolgStand,
  sorteerKlanten,
  type KlantSortering
} from '@/lib/crm/opvolging';
import { useToast } from '@/components/agenda/Toast';
import { crmApi } from './CrmDialoog';
import { LeadActies, OpvolgVelden } from './KlantActies';
import { OpvolgBadge, StatusPil } from './StatusPil';

const TABS: KlantStatus[] = ['lead', 'actief', 'afgerond'];
const TAB_LABEL: Record<KlantStatus, string> = { lead: 'Leads', actief: 'Actief', afgerond: 'Afgerond' };
const STANDAARD_SORTERING: Record<KlantStatus, KlantSortering> = { lead: 'opvolgen', actief: 'actief', afgerond: 'naam' };
const TAB_SLEUTEL = 'sl-klanten-tab';
/** Event van de knop "+ Klant" in de kop: focus op het snelle invoerveld. */
export const NIEUW_EVENT = 'kp:nieuwe-klant';

function typtIn(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * Het klantenoverzicht met drie tabs: Leads (opvolgen: volgende stap, datum, gewonnen/
 * afgewezen), Actief en Afgerond (afgeronde klanten blijven vindbaar; zoeken telt per tab).
 * Zoeken (/), sorteren en snel toevoegen (n of "+ Klant": één veld + Enter) gebeuren
 * direct in de browser; de lijst is klein. Bedragen komen alleen-lezen uit de facturen.
 */
export function KlantenLijst({
  klanten,
  opvolging,
  vandaag,
  nu,
  startTab,
  startNieuw = false
}: {
  klanten: KlantRegel[];
  /** false vóór migratie 0025: geen volgende stap / opvolgdatum. */
  opvolging: boolean;
  vandaag: string;
  /** ISO-moment van de server, zodat "5 d geleden" op server en client gelijk is. */
  nu: string;
  startTab?: KlantStatus;
  startNieuw?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<KlantStatus>(startTab ?? 'actief');
  const [q, setQ] = useState('');
  const [sortering, setSortering] = useState<KlantSortering>(STANDAARD_SORTERING[startTab ?? 'actief']);
  const [nieuw, setNieuw] = useState('');
  const [bezig, setBezig] = useState(false);
  const [vers, setVers] = useState<string | null>(null);
  const zoekVeld = useRef<HTMLInputElement>(null);
  const nieuwVeld = useRef<HTMLInputElement>(null);
  const moment = useMemo(() => new Date(nu), [nu]);

  function kiesTab(t: KlantStatus) {
    setTab(t);
    setSortering(STANDAARD_SORTERING[t]);
    try {
      localStorage.setItem(TAB_SLEUTEL, t);
    } catch {
      /* niet bewaren */
    }
  }

  // Onthouden tab (tenzij de URL er een kiest), en ?nieuw=1 → meteen typen.
  useEffect(() => {
    if (!startTab) {
      try {
        const t = localStorage.getItem(TAB_SLEUTEL);
        if (t === 'lead' || t === 'actief' || t === 'afgerond') {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTab(t);
          setSortering(STANDAARD_SORTERING[t]);
        }
      } catch {
        /* standaard: Actief */
      }
    }
    if (startNieuw) nieuwVeld.current?.focus();
  }, [startTab, startNieuw]);

  // Sneltoetsen: / = zoeken, n = nieuwe klant/lead. "+ Klant" in de kop doet hetzelfde.
  useEffect(() => {
    function focusNieuw() {
      setTab((t) => (t === 'afgerond' ? 'lead' : t));
      requestAnimationFrame(() => nieuwVeld.current?.focus());
    }
    function toets(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typtIn(e.target) || document.querySelector('[role="dialog"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        zoekVeld.current?.focus();
      } else if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        focusNieuw();
      }
    }
    document.addEventListener('keydown', toets);
    window.addEventListener(NIEUW_EVENT, focusNieuw);
    return () => {
      document.removeEventListener('keydown', toets);
      window.removeEventListener(NIEUW_EVENT, focusNieuw);
    };
  }, []);

  const gevonden = useMemo(() => klanten.filter((k) => klantPast(k, q)), [klanten, q]);
  const aantal = (t: KlantStatus) => gevonden.filter((k) => k.status === t).length;
  const teLaat = klanten.filter((k) => k.status === 'lead' && (opvolgStand(k.opvolgenOp, vandaag) === 'telaat' || opvolgStand(k.opvolgenOp, vandaag) === 'vandaag')).length;
  const zichtbaar = useMemo(() => sorteerKlanten(gevonden.filter((k) => k.status === tab), sortering), [gevonden, tab, sortering]);
  const elders = TABS.filter((t) => t !== tab && aantal(t) > 0);

  async function toevoegen(e: React.FormEvent) {
    e.preventDefault();
    const naam = nieuw.replace(/\s+/g, ' ').trim();
    if (!naam || bezig) return;
    const status: KlantStatus = tab === 'actief' ? 'actief' : 'lead';
    setBezig(true);
    try {
      const { klant } = await crmApi<{ klant: { id: string } }>('/api/klanten', 'POST', { naam, status });
      setNieuw('');
      setVers(klant.id);
      if (tab === 'afgerond') setTab('lead');
      toast(`${naam} toegevoegd als ${KLANT_STATUS_LABEL[status].toLowerCase()}`, { actie: { label: 'Openen', onClick: () => router.push(`/klanten/${klant.id}`) } });
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Toevoegen mislukt.', { fout: true });
    } finally {
      setBezig(false);
    }
  }

  const sorteerKnoppen: KlantSortering[] = tab === 'lead' ? ['opvolgen', 'naam', 'actief'] : ['naam', 'actief', 'omzet'];

  return (
    <div className="kl">
      <div className="kl-tabs" role="tablist" aria-label="Klanten per status">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`kl-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="kl-paneel"
            className={`kl-tab kl-tab-${t}${tab === t ? ' is-aan' : ''}`}
            onClick={() => kiesTab(t)}
          >
            <span className="kl-tab-label">{TAB_LABEL[t]}</span>
            <span className="kl-tab-n">{aantal(t)}</span>
            {t === 'lead' && opvolging && teLaat > 0 && (
              <span className="kl-tab-alarm" title={`${teLaat} ${teLaat === 1 ? 'lead' : 'leads'} vandaag of te laat opvolgen`}>
                {teLaat}
                <span className="kl-tab-alarm-tekst"> opvolgen</span>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="kl-balk">
        <form className="kl-nieuw" onSubmit={toevoegen}>
          <span className="kl-nieuw-plus" aria-hidden="true">
            +
          </span>
          <input
            ref={nieuwVeld}
            className="kl-nieuw-veld"
            value={nieuw}
            maxLength={200}
            placeholder={tab === 'actief' ? 'Nieuwe klant (naam + Enter)' : 'Nieuwe lead (naam + Enter)'}
            aria-label={tab === 'actief' ? 'Nieuwe klant toevoegen' : 'Nieuwe lead toevoegen'}
            onChange={(e) => setNieuw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNieuw('');
                e.currentTarget.blur();
              }
            }}
            disabled={bezig}
          />
          {nieuw.trim() ? (
            <button type="submit" className="db-knop db-knop-klein db-knop-primair" disabled={bezig}>
              {bezig ? 'Bezig…' : 'Toevoegen'}
            </button>
          ) : (
            <kbd className="kl-kbd" aria-hidden="true">
              n
            </kbd>
          )}
        </form>
        <div className="kl-zoek">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={zoekVeld}
            className="kl-zoek-veld"
            type="search"
            placeholder="Zoek in alle klanten"
            aria-label="Zoek klanten op naam, contactpersoon, e-mail of telefoon"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQ('');
                e.currentTarget.blur();
              }
            }}
          />
          {!q && (
            <kbd className="kl-kbd" aria-hidden="true">
              /
            </kbd>
          )}
        </div>
      </div>

      <section id="kl-paneel" role="tabpanel" aria-labelledby={`kl-tab-${tab}`} className="kl-paneel">
        {zichtbaar.length > 0 && (
          <div className="kl-sorteer" role="group" aria-label="Sorteren">
            <span className="kl-sorteer-label">Sorteer</span>
            {sorteerKnoppen.map((s) => (
              <button key={s} type="button" className={`kp-chip${sortering === s ? ' is-aan' : ''}`} aria-pressed={sortering === s} onClick={() => setSortering(s)}>
                {SORTERING_LABEL[s]}
              </button>
            ))}
          </div>
        )}

        {zichtbaar.length === 0 ? (
          <LegeStaat
            tab={tab}
            zoekt={!!q.trim()}
            elders={elders.map((t) => ({ t, n: aantal(t) }))}
            onTab={kiesTab}
            onNieuw={() => nieuwVeld.current?.focus()}
          />
        ) : tab === 'lead' ? (
          <ul className="kl-lijst kl-leads">
            {zichtbaar.map((k) => (
              <li key={k.id} className={vers === k.id ? 'is-nieuw' : undefined}>
                <LeadKaart klant={k} opvolging={opvolging} vandaag={vandaag} moment={moment} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="kl-tabel" role="table" aria-label={`${TAB_LABEL[tab]} klanten`}>
            <div className="kl-kop" role="row">
              <span role="columnheader">Klant</span>
              <span role="columnheader">Projecten</span>
              <span role="columnheader" className="kl-r">
                Omzet
              </span>
              <span role="columnheader">Laatste contact</span>
              <span role="columnheader">{opvolging ? 'Opvolgen' : ''}</span>
            </div>
            {zichtbaar.map((k) => (
              <KlantRij key={k.id} klant={k} opvolging={opvolging} vandaag={vandaag} moment={moment} nieuw={vers === k.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function LegeStaat({
  tab,
  zoekt,
  elders,
  onTab,
  onNieuw
}: {
  tab: KlantStatus;
  zoekt: boolean;
  elders: { t: KlantStatus; n: number }[];
  onTab: (t: KlantStatus) => void;
  onNieuw: () => void;
}) {
  if (zoekt) {
    return (
      <div className="kl-leeg">
        <p className="kl-leeg-titel">Niets gevonden onder {TAB_LABEL[tab]}</p>
        {elders.length > 0 ? (
          <p className="kl-leeg-tekst">
            Wel in{' '}
            {elders.map(({ t, n }, i) => (
              <span key={t}>
                {i > 0 && ' en '}
                <button type="button" className="kp-linkknop" onClick={() => onTab(t)}>
                  {TAB_LABEL[t]} ({n})
                </button>
              </span>
            ))}
            .
          </p>
        ) : (
          <p className="kl-leeg-tekst">Geen enkele klant past bij je zoekopdracht.</p>
        )}
      </div>
    );
  }
  const tekst: Record<KlantStatus, [string, string]> = {
    lead: ['Geen open leads', 'Komt er een aanvraag binnen? Typ de naam hierboven en druk op Enter; details vul je later aan.'],
    actief: ['Nog geen actieve klanten', 'Voeg een klant toe met het veld hierboven. Klanten die je bij een factuur aanmaakt, komen hier vanzelf.'],
    afgerond: ['Nog niets afgerond', 'Afgeronde klanten en afgewezen leads blijven hier vindbaar.']
  };
  return (
    <div className="kl-leeg">
      <p className="kl-leeg-titel">{tekst[tab][0]}</p>
      <p className="kl-leeg-tekst">{tekst[tab][1]}</p>
      {tab !== 'afgerond' && (
        <button type="button" className="db-knop" onClick={onNieuw}>
          {tab === 'lead' ? '+ Lead toevoegen' : '+ Klant toevoegen'}
        </button>
      )}
    </div>
  );
}

function Contact({ k }: { k: KlantRegel }) {
  const delen = [k.contactpersoon, k.email || k.telefoon].filter(Boolean);
  return <span className="kl-sub">{delen.length ? delen.join(' · ') : 'Nog geen contactgegevens'}</span>;
}

function LeadKaart({ klant: k, opvolging, vandaag, moment }: { klant: KlantRegel; opvolging: boolean; vandaag: string; moment: Date }) {
  const stand = opvolgStand(k.opvolgenOp, vandaag);
  return (
    <article className={`kl-lead${stand === 'telaat' ? ' is-telaat' : stand === 'vandaag' ? ' is-vandaag' : ''}`}>
      <div className="kl-lead-hoofd">
        <Link className="kl-naam" href={`/klanten/${k.id}`}>
          {k.naam}
        </Link>
        <Contact k={k} />
        <span className="kl-lead-meta">
          {k.laatsteContact ? <span title={`Laatste notitie ${korteDatum(k.laatsteContact)}`}>contact {geledenKort(k.laatsteContact, moment)}</span> : <span>nog geen contact</span>}
          {k.lopendeProjecten > 0 && (
            <span>
              {k.lopendeProjecten} {k.lopendeProjecten === 1 ? 'project' : 'projecten'}
            </span>
          )}
        </span>
      </div>
      {opvolging ? (
        <OpvolgVelden klantId={k.id} klantNaam={k.naam} volgendeStap={k.volgendeStap} opvolgenOp={k.opvolgenOp} vandaag={vandaag} />
      ) : (
        <span />
      )}
      <LeadActies klant={k} opvolging={opvolging} klein />
    </article>
  );
}

function KlantRij({ klant: k, opvolging, vandaag, moment, nieuw }: { klant: KlantRegel; opvolging: boolean; vandaag: string; moment: Date; nieuw: boolean }) {
  return (
    <Link className={`kl-rij${k.status === 'afgerond' ? ' is-af' : ''}${nieuw ? ' is-nieuw' : ''}`} href={`/klanten/${k.id}`} role="row">
      <span className="kl-cel kl-cel-naam" role="cell">
        <span className="kl-naam">{k.naam}</span>
        <Contact k={k} />
      </span>
      <span className="kl-cel" role="cell">
        {k.lopendeProjecten > 0 && k.projectStatus ? (
          <span className="kl-proj">
            <span className="kl-proj-n">{k.lopendeProjecten}</span>
            <StatusPil status={k.projectStatus} klein />
          </span>
        ) : (
          <span className="kl-zacht">—</span>
        )}
      </span>
      <span className="kl-cel kl-r" role="cell">
        {k.omzet > 0 ? <span className="kl-bedrag">€ {formatEuro(k.omzet)}</span> : <span className="kl-zacht">—</span>}
        {k.openAanbetalingen > 0 && (
          <span className="kl-open" title="Aanbetaling zonder restfactuur">
            {k.openAanbetalingen} open
          </span>
        )}
      </span>
      <span className="kl-cel kl-zacht" role="cell" title={k.laatsteContact ? `Laatste notitie ${korteDatum(k.laatsteContact)}` : undefined}>
        <span className="kl-mlabel">Contact </span>
        {geledenKort(k.laatsteContact, moment)}
      </span>
      <span className="kl-cel kl-cel-opvolg" role="cell">
        {opvolging && (k.opvolgenOp || k.volgendeStap) ? (
          <>
            <OpvolgBadge datum={k.opvolgenOp} vandaag={vandaag} />
            {k.volgendeStap && <span className="kl-stap">{k.volgendeStap}</span>}
          </>
        ) : null}
      </span>
    </Link>
  );
}

/** "+ Klant" in de kop: springt naar het snelle invoerveld (geen popup meer). */
export function NieuweKlantKnop() {
  return (
    <button type="button" className="db-knop db-knop-primair" onClick={() => window.dispatchEvent(new Event(NIEUW_EVENT))} title="Nieuwe klant of lead (n)">
      + Klant
    </button>
  );
}
