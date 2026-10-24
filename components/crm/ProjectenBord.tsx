'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import { korteDatum } from '@/lib/dashboard/tijd';
import type { Project, ProjectStatus } from '@/lib/agenda/types';
import {
  BORD_STATUSSEN,
  PROJECT_STATUS_KORT,
  PROJECT_STATUS_LABEL,
  RECENT_AFGEROND_DAGEN,
  buurStatus,
  dagenSinds,
  dagenTekst,
  deadlineStand,
  isRecentAfgerond,
  opDeadline
} from '@/lib/crm/projectstatus';
import { useToast } from '@/components/agenda/Toast';
import { useTeam } from '@/components/team/TeamProvider';
import { DeadlineBadge, Eigenaren } from './ProjectRegels';
import { Voortgang } from './StatusPil';

type Weergave = 'bord' | 'lijst';
type Wie = 'iedereen' | 'mijn';
type Groep = 'status' | 'klant';
const WEERGAVE_SLEUTEL = 'sl-projecten-weergave';
const MIJN_SLEUTEL = 'sl-projecten-mijn';
const GROEP_SLEUTEL = 'sl-projecten-groep';
/** Na zoveel dagen in dezelfde status (niet afgerond) tonen we "x dagen in deze status". */
const STIL_DAGEN = 14;
/** Lijstweergave op status: wat aandacht vraagt eerst. */
const LIJST_VOLGORDE: ProjectStatus[] = ['wachten', 'bezig', 'voorbereiding', 'afgerond'];

function typtIn(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/**
 * /projecten: een bord met vier kolommen (Voorbereiding, Bezig, Wachten op goedkeuring,
 * Afgerond) of een lijst, gegroepeerd op status of klant. Filteren op Iedereen/Alleen mijn
 * projecten, op klant en zoeken (/). Status wijzigen kan door te slepen, via de statuskeuze
 * op de kaart, of met Alt + ←/→ op een kaart. Weergave, groepering en "mijn" worden in deze
 * browser onthouden. Afgerond toont standaard de laatste 30 dagen.
 */
export function ProjectenBord({
  projecten,
  vandaag,
  nu,
  startWeergave
}: {
  projecten: Project[];
  vandaag: string;
  /** ISO-moment van de server, zodat "x dagen" op server en client gelijk is. */
  nu: string;
  /** ?weergave=bord|lijst (bv. vanaf het dashboard): wint van wat onthouden is. */
  startWeergave?: Weergave;
}) {
  const router = useRouter();
  const toast = useToast();
  const { mijnId } = useTeam();
  const [weergave, setWeergave] = useState<Weergave>(startWeergave ?? 'bord');
  const [wie, setWie] = useState<Wie>('iedereen');
  const [groep, setGroep] = useState<Groep>('status');
  const [klant, setKlant] = useState('');
  const [q, setQ] = useState('');
  const [alleAfgerond, setAlleAfgerond] = useState(false);
  // Direct zichtbaar verplaatsen; de echte stand komt met router.refresh().
  const [omgezet, setOmgezet] = useState<Record<string, ProjectStatus>>({});
  const [sleept, setSleept] = useState<string | null>(null);
  const [boven, setBoven] = useState<ProjectStatus | null>(null);
  const zoekVeld = useRef<HTMLInputElement>(null);
  const moment = useMemo(() => new Date(nu), [nu]);

  useEffect(() => {
    try {
      if (startWeergave) localStorage.setItem(WEERGAVE_SLEUTEL, startWeergave);
      else {
        const w = localStorage.getItem(WEERGAVE_SLEUTEL);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (w === 'bord' || w === 'lijst') setWeergave(w);
      }
      if (localStorage.getItem(MIJN_SLEUTEL) === '1') setWie('mijn');
      if (localStorage.getItem(GROEP_SLEUTEL) === 'klant') setGroep('klant');
    } catch {
      /* geen opslag: standaard het bord, alle projecten */
    }
  }, [startWeergave]);

  // / = zoeken (n blijft "nieuwe taak", zoals overal).
  useEffect(() => {
    function toets(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typtIn(e.target) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      zoekVeld.current?.focus();
    }
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, []);

  function bewaar(sleutel: string, waarde: string) {
    try {
      localStorage.setItem(sleutel, waarde);
    } catch {
      /* niet bewaren */
    }
  }

  const klanten = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projecten) if (p.klantId) m.set(p.klantId, p.klantNaam ?? 'Klant');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'nl'));
  }, [projecten]);

  const lijst = useMemo(() => {
    const z = q.trim().toLowerCase();
    return projecten
      .map((p) => (p.id in omgezet && omgezet[p.id] !== p.status ? { ...p, status: omgezet[p.id], statusSinds: nu } : p))
      .filter((p) => wie === 'iedereen' || p.eigenaren.includes(mijnId))
      .filter((p) => !klant || (klant === '-' ? !p.klantId : p.klantId === klant))
      .filter((p) => !z || p.naam.toLowerCase().includes(z) || (p.klantNaam ?? '').toLowerCase().includes(z));
  }, [projecten, omgezet, wie, mijnId, klant, q, nu]);
  const afgerond = lijst.filter((p) => p.status === 'afgerond');
  const afgerondZichtbaar = alleAfgerond ? afgerond : afgerond.filter((p) => isRecentAfgerond(p.statusSinds, moment));
  const verborgen = afgerond.length - afgerondZichtbaar.length;
  const filtertActief = wie === 'mijn' || !!klant || !!q.trim();

  async function zetStatus(p: Project, status: ProjectStatus) {
    if (p.status === status) return;
    const oud = p.status;
    setOmgezet((m) => ({ ...m, [p.id]: status }));
    try {
      await agendaApi.wijzigProject(p.id, { status });
      toast(`${p.naam} → ${PROJECT_STATUS_LABEL[status]}`);
      router.refresh();
    } catch (e) {
      setOmgezet((m) => ({ ...m, [p.id]: oud }));
      toast(e instanceof Error ? e.message : 'Niet gelukt.', { fout: true });
    }
  }

  function toets(e: React.KeyboardEvent, p: Project) {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const s = buurStatus(p.status, e.key === 'ArrowLeft' ? -1 : 1);
    if (!s) return;
    e.preventDefault();
    void zetStatus(p, s);
  }

  const kaartProps = { vandaag, moment, onStatus: zetStatus, onToets: toets };
  const afgerondKnop = (verborgen > 0 || alleAfgerond) && (
    <button type="button" className="kp-linkknop pb-meer" onClick={() => setAlleAfgerond(!alleAfgerond)}>
      {alleAfgerond ? `Alleen afgerond in de laatste ${RECENT_AFGEROND_DAGEN} dagen` : `Toon alle ${afgerond.length} afgeronde`}
    </button>
  );

  return (
    <div className="pb">
      <div className="pb-balk">
        <div className="pb-knoppen">
          <div className="ag-segment" role="group" aria-label="Weergave">
            {(['bord', 'lijst'] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={weergave === w}
                className={weergave === w ? 'is-aan' : ''}
                onClick={() => {
                  setWeergave(w);
                  bewaar(WEERGAVE_SLEUTEL, w);
                }}
              >
                {w === 'bord' ? 'Bord' : 'Lijst'}
              </button>
            ))}
          </div>
          <div className="ag-segment" role="group" aria-label="Wiens projecten (Alleen mijn projecten: waar jij eigenaar bent)">
            {(['iedereen', 'mijn'] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={wie === w}
                className={wie === w ? 'is-aan' : ''}
                onClick={() => {
                  setWie(w);
                  bewaar(MIJN_SLEUTEL, w === 'mijn' ? '1' : '0');
                }}
              >
                {w === 'iedereen' ? 'Iedereen' : 'Mijn projecten'}
              </button>
            ))}
          </div>
          {klanten.length > 0 && (
            <select className="ag-veld pb-select" aria-label="Filter op klant" value={klant} onChange={(e) => setKlant(e.target.value)}>
              <option value="">Alle klanten</option>
              {klanten.map(([id, naam]) => (
                <option key={id} value={id}>
                  {naam}
                </option>
              ))}
              <option value="-">Zonder klant</option>
            </select>
          )}
          {weergave === 'lijst' && (
            <select
              className="ag-veld pb-select"
              aria-label="Groeperen"
              value={groep}
              onChange={(e) => {
                const g = e.target.value === 'klant' ? 'klant' : 'status';
                setGroep(g);
                bewaar(GROEP_SLEUTEL, g);
              }}
            >
              <option value="status">Groeperen op status</option>
              <option value="klant">Groeperen op klant</option>
            </select>
          )}
        </div>
        <div className="kl-zoek pb-zoek">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={zoekVeld}
            className="kl-zoek-veld"
            type="search"
            placeholder="Zoek project of klant"
            aria-label="Zoek projecten op naam of klant"
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

      {lijst.length === 0 ? (
        <div className="kl-leeg">
          <p className="kl-leeg-titel">Geen projecten gevonden</p>
          <p className="kl-leeg-tekst">
            {wie === 'mijn' ? 'Er staan geen projecten op jouw naam die hierbij passen.' : 'Geen project past bij deze filters.'}
          </p>
          {filtertActief && (
            <button
              type="button"
              className="db-knop"
              onClick={() => {
                setWie('iedereen');
                bewaar(MIJN_SLEUTEL, '0');
                setKlant('');
                setQ('');
              }}
            >
              Filters wissen
            </button>
          )}
        </div>
      ) : weergave === 'bord' ? (
        <div className="pb-bord">
          {BORD_STATUSSEN.map((status) => {
            const inKolom = (status === 'afgerond' ? afgerondZichtbaar : lijst.filter((p) => p.status === status)).sort(
              status === 'afgerond' ? (a, b) => ((a.statusSinds ?? '') < (b.statusSinds ?? '') ? 1 : -1) : opDeadline
            );
            const aantal = status === 'afgerond' ? afgerond.length : inKolom.length;
            const teLaat = inKolom.filter((p) => deadlineStand(p.deadline, vandaag, p.status) === 'telaat').length;
            return (
              <section
                key={status}
                id={`kolom-${status}`}
                className={`pb-kolom pb-kolom-${status}${boven === status && sleept ? ' is-doel' : ''}`}
                aria-labelledby={`kolom-${status}-kop`}
                onDragOver={(e) => {
                  if (!sleept) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (boven !== status) setBoven(status);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setBoven(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/x-project') || sleept;
                  const p = lijst.find((x) => x.id === id);
                  setBoven(null);
                  setSleept(null);
                  if (p) void zetStatus(p, status);
                }}
              >
                <h2 id={`kolom-${status}-kop`} className="pb-kolom-kop">
                  <span className={`kp-stip kp-stip-${status}`} aria-hidden="true" />
                  <span className="pb-kolom-naam">{PROJECT_STATUS_LABEL[status]}</span>
                  <span className="pb-kolom-n">{aantal}</span>
                  {teLaat > 0 && <span className="pb-kolom-telaat">{teLaat} te laat</span>}
                </h2>
                {inKolom.length === 0 ? (
                  <p className="pb-leeg">
                    {status === 'afgerond' && verborgen ? `Niets afgerond in de laatste ${RECENT_AFGEROND_DAGEN} dagen.` : sleept ? 'Sleep hierheen' : 'Geen projecten'}
                  </p>
                ) : (
                  <ul className="pb-kaarten">
                    {inKolom.map((p) => (
                      <li key={p.id}>
                        <ProjectKaart project={p} {...kaartProps} sleept={sleept === p.id} onSleep={(id) => setSleept(id)} />
                      </li>
                    ))}
                  </ul>
                )}
                {status === 'afgerond' && afgerondKnop}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="pb-lijst">
          {groepeer([...lijst.filter((p) => p.status !== 'afgerond'), ...afgerondZichtbaar], groep).map((g) => (
            <section key={g.sleutel} className="pb-groep" aria-label={g.titel}>
              <h2 className="pb-groep-kop">
                {g.status && <span className={`kp-stip kp-stip-${g.status}`} aria-hidden="true" />}
                {g.klantId ? <Link href={`/klanten/${g.klantId}`}>{g.titel}</Link> : <span>{g.titel}</span>}
                <span className="pb-kolom-n">{g.projecten.length}</span>
              </h2>
              <div className="pb-tabel" role="table" aria-label={g.titel}>
                {g.projecten.map((p) => (
                  <ProjectRegel key={p.id} project={p} {...kaartProps} toonKlant={groep !== 'klant'} />
                ))}
              </div>
            </section>
          ))}
          {afgerondKnop}
        </div>
      )}
      <p className="pb-hint">
        {weergave === 'bord' ? 'Sleep een kaart naar een andere kolom of kies de status op de kaart' : 'Kies de status rechts op de regel'} · <kbd>Alt</kbd> + <kbd>←</kbd>/<kbd>→</kbd> verplaatst · <kbd>/</kbd> zoekt ·{' '}
        <kbd>n</kbd> nieuwe taak
      </p>
    </div>
  );
}

interface Groepje {
  sleutel: string;
  titel: string;
  status?: ProjectStatus;
  klantId?: string;
  projecten: Project[];
}

function groepeer(projecten: Project[], op: Groep): Groepje[] {
  if (op === 'status') {
    return LIJST_VOLGORDE.map((s) => ({
      sleutel: s,
      titel: PROJECT_STATUS_LABEL[s],
      status: s,
      projecten: projecten.filter((p) => p.status === s).sort(opDeadline)
    })).filter((g) => g.projecten.length);
  }
  const m = new Map<string, Groepje>();
  for (const p of projecten) {
    const sleutel = p.klantId ?? '-';
    if (!m.has(sleutel)) m.set(sleutel, { sleutel, titel: p.klantNaam ?? 'Zonder klant', klantId: p.klantId ?? undefined, projecten: [] });
    m.get(sleutel)!.projecten.push(p);
  }
  const volg = (p: Project) => LIJST_VOLGORDE.indexOf(p.status);
  return [...m.values()]
    .map((g) => ({ ...g, projecten: g.projecten.sort((a, b) => volg(a) - volg(b) || opDeadline(a, b)) }))
    .sort((a, b) => (a.sleutel === '-' ? 1 : b.sleutel === '-' ? -1 : a.titel.localeCompare(b.titel, 'nl')));
}

interface KaartProps {
  project: Project;
  vandaag: string;
  moment: Date;
  onStatus: (p: Project, s: ProjectStatus) => void;
  onToets: (e: React.KeyboardEvent, p: Project) => void;
}

/** Statuskeuze op een kaart of regel: een gewone keuzelijst (toetsenbord, telefoon). */
function StatusKeuze({ project, onStatus, kaal = false }: { project: Project; onStatus: KaartProps['onStatus']; kaal?: boolean }) {
  return (
    <select
      className={`pb-status kp-pil kp-pil-${project.status}${kaal ? ' pb-status-kaal' : ''}`}
      aria-label={`Status van ${project.naam}`}
      title="Status wijzigen"
      value={project.status}
      onChange={(e) => onStatus(project, e.target.value as ProjectStatus)}
    >
      {BORD_STATUSSEN.map((s) => (
        <option key={s} value={s}>
          {PROJECT_STATUS_KORT[s]}
        </option>
      ))}
    </select>
  );
}

function isStil(p: Project, moment: Date): boolean {
  const d = dagenSinds(p.statusSinds, moment);
  return d !== null && d >= STIL_DAGEN && p.status !== 'afgerond';
}

/** "21 dagen stil": alleen als een lopend project al lang in dezelfde status staat. */
function Stil({ project, moment }: { project: Project; moment: Date }) {
  if (!isStil(project, moment)) return null;
  const d = dagenSinds(project.statusSinds, moment) as number;
  return (
    <span className="pb-sinds" title={`In deze status sinds ${korteDatum(project.statusSinds as string)}`}>
      {dagenTekst(d)} stil
    </span>
  );
}

function ProjectKaart({
  project: p,
  vandaag,
  moment,
  onStatus,
  onToets,
  sleept,
  onSleep
}: KaartProps & { sleept: boolean; onSleep: (id: string | null) => void }) {
  const stand = deadlineStand(p.deadline, vandaag, p.status);
  return (
    <article
      className={`pb-kaart pb-kaart-${p.status}${sleept ? ' is-sleept' : ''}${p.status === 'afgerond' ? ' is-af' : ''}${stand === 'telaat' ? ' is-telaat' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-project', p.id);
        e.dataTransfer.effectAllowed = 'move';
        onSleep(p.id);
      }}
      onDragEnd={() => onSleep(null)}
      onKeyDown={(e) => onToets(e, p)}
    >
      <div className="pb-kaart-hoofd">
        <Link className="pb-kaart-link" href={`/projecten/${p.id}`} draggable={false}>
          {p.naam}
        </Link>
        <p className="pb-kaart-klant">{p.klantNaam ?? 'Zonder klant'}</p>
      </div>
      {(p.deadline || p.totaalTaken > 0 || p.eigenaren.length > 0) && (
        <div className="pb-kaart-meta">
          <DeadlineBadge project={p} vandaag={vandaag} />
          {p.totaalTaken > 0 && <Voortgang open={p.openTaken} totaal={p.totaalTaken} />}
          <Eigenaren ids={p.eigenaren} />
        </div>
      )}
      {isStil(p, moment) && (
        <div className="pb-kaart-voet">
          <Stil project={p} moment={moment} />
        </div>
      )}
      <StatusKeuze project={p} onStatus={onStatus} kaal />
    </article>
  );
}

function ProjectRegel({ project: p, vandaag, moment, onStatus, onToets, toonKlant }: KaartProps & { toonKlant: boolean }) {
  return (
    <article className={`pb-regel${p.status === 'afgerond' ? ' is-af' : ''}`} role="row" onKeyDown={(e) => onToets(e, p)}>
      <span className="pb-regel-naam" role="cell">
        <Link className="pb-kaart-link" href={`/projecten/${p.id}`}>
          {p.naam}
        </Link>
        {(toonKlant || isStil(p, moment)) && (
          <span className="kl-sub">
            {toonKlant && (p.klantNaam ?? 'Zonder klant')}
            {toonKlant && isStil(p, moment) && ' · '}
            <Stil project={p} moment={moment} />
          </span>
        )}
      </span>
      <span className="pb-regel-cel" role="cell">
        <Eigenaren ids={p.eigenaren} />
      </span>
      <span className="pb-regel-cel" role="cell">
        {p.totaalTaken > 0 ? <Voortgang open={p.openTaken} totaal={p.totaalTaken} /> : <span className="kl-zacht">geen taken</span>}
      </span>
      <span className="pb-regel-cel" role="cell">
        <DeadlineBadge project={p} vandaag={vandaag} leeg="geen deadline" />
      </span>
      <span className="pb-regel-cel pb-regel-status" role="cell">
        <StatusKeuze project={p} onStatus={onStatus} />
      </span>
    </article>
  );
}

