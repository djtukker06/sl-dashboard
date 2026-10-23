'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import { dagTekst } from '@/lib/agenda/datum';
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
import { Persoon } from '@/components/team/Persoon';
import { useTeam } from '@/components/team/TeamProvider';
import { Voortgang } from './StatusPil';

type Weergave = 'bord' | 'lijst';
const WEERGAVE_SLEUTEL = 'sl-projecten-weergave';
const MIJN_SLEUTEL = 'sl-projecten-mijn';

/**
 * /projecten: een bord met vier kolommen (Voorbereiding, Bezig, Wachten op goedkeuring,
 * Afgerond) of een compacte lijst op deadline. Status wijzigen kan door te slepen, via de
 * keuzelijst op de kaart, of met Alt + ←/→ op een kaart. Weergave en "Alleen mijn
 * projecten" worden in deze browser onthouden. Afgerond toont standaard de laatste 30 dagen.
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
  const [alleenMijn, setAlleenMijn] = useState(false);
  const [alleAfgerond, setAlleAfgerond] = useState(false);
  // Direct zichtbaar verplaatsen; de echte stand komt met router.refresh().
  const [omgezet, setOmgezet] = useState<Record<string, ProjectStatus>>({});
  const [sleept, setSleept] = useState<string | null>(null);
  const [boven, setBoven] = useState<ProjectStatus | null>(null);
  const moment = useMemo(() => new Date(nu), [nu]);

  useEffect(() => {
    try {
      if (startWeergave) localStorage.setItem(WEERGAVE_SLEUTEL, startWeergave);
      else {
        const w = localStorage.getItem(WEERGAVE_SLEUTEL);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (w === 'bord' || w === 'lijst') setWeergave(w);
      }
      if (localStorage.getItem(MIJN_SLEUTEL) === '1') setAlleenMijn(true);
    } catch {
      /* geen opslag: standaard het bord, alle projecten */
    }
  }, [startWeergave]);

  function bewaar(sleutel: string, waarde: string) {
    try {
      localStorage.setItem(sleutel, waarde);
    } catch {
      /* niet bewaren */
    }
  }

  const lijst = useMemo(
    () =>
      projecten
        .map((p) => (p.id in omgezet && omgezet[p.id] !== p.status ? { ...p, status: omgezet[p.id], statusSinds: nu } : p))
        .filter((p) => !alleenMijn || p.eigenaren.includes(mijnId)),
    [projecten, omgezet, alleenMijn, mijnId, nu]
  );
  const afgerond = lijst.filter((p) => p.status === 'afgerond');
  const afgerondZichtbaar = alleAfgerond ? afgerond : afgerond.filter((p) => isRecentAfgerond(p.statusSinds, moment));
  const verborgen = afgerond.length - afgerondZichtbaar.length;

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

  return (
    <div className="pb">
      <div className="kp-balk">
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
          <button
            type="button"
            className={`db-knop pb-filter${alleenMijn ? ' is-aan' : ''}`}
            aria-pressed={alleenMijn}
            onClick={() => {
              setAlleenMijn(!alleenMijn);
              bewaar(MIJN_SLEUTEL, alleenMijn ? '0' : '1');
            }}
          >
            Alleen mijn projecten
          </button>
        </div>
        <p className="pb-hint">
          {weergave === 'bord' ? 'Sleep een kaart naar een andere kolom, of kies de status op de kaart' : 'Gesorteerd op deadline'} ·{' '}
          <kbd>Alt</kbd> + <kbd>←</kbd>/<kbd>→</kbd> verplaatst
        </p>
      </div>

      {alleenMijn && lijst.length === 0 ? (
        <p className="kp-leeg">Er staan geen projecten op jouw naam. Zet het filter uit om alles te zien.</p>
      ) : weergave === 'bord' ? (
        <div className="pb-bord">
          {BORD_STATUSSEN.map((status) => {
            const inKolom = (status === 'afgerond' ? afgerondZichtbaar : lijst.filter((p) => p.status === status)).sort(
              status === 'afgerond' ? (a, b) => ((a.statusSinds ?? '') < (b.statusSinds ?? '') ? 1 : -1) : opDeadline
            );
            const aantal = status === 'afgerond' ? afgerond.length : inKolom.length;
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
                  {PROJECT_STATUS_LABEL[status]} <span>{aantal}</span>
                </h2>
                {inKolom.length === 0 ? (
                  <p className="pb-leeg">{status === 'afgerond' && verborgen ? `Niets afgerond in de laatste ${RECENT_AFGEROND_DAGEN} dagen.` : 'Leeg'}</p>
                ) : (
                  <ul className="pb-kaarten">
                    {inKolom.map((p) => (
                      <li key={p.id}>
                        <ProjectKaart
                          project={p}
                          {...kaartProps}
                          sleept={sleept === p.id}
                          onSleep={(id) => setSleept(id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {status === 'afgerond' && (verborgen > 0 || alleAfgerond) && (
                  <button type="button" className="kp-linkknop pb-meer" onClick={() => setAlleAfgerond(!alleAfgerond)}>
                    {alleAfgerond ? `Alleen laatste ${RECENT_AFGEROND_DAGEN} dagen` : `Toon alle ${afgerond.length} afgeronde`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="pb-lijst">
          <ul className="kp-lijst">
            {[...lijst.filter((p) => p.status !== 'afgerond').sort(opDeadline), ...afgerondZichtbaar.sort(opDeadline)].map((p) => (
              <li key={p.id}>
                <ProjectRegel project={p} {...kaartProps} />
              </li>
            ))}
          </ul>
          {(verborgen > 0 || alleAfgerond) && (
            <button type="button" className="kp-linkknop pb-meer" onClick={() => setAlleAfgerond(!alleAfgerond)}>
              {alleAfgerond ? `Afgerond: alleen laatste ${RECENT_AFGEROND_DAGEN} dagen` : `Toon alle ${afgerond.length} afgeronde projecten`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface KaartProps {
  project: Project;
  vandaag: string;
  moment: Date;
  onStatus: (p: Project, s: ProjectStatus) => void;
  onToets: (e: React.KeyboardEvent, p: Project) => void;
}

/** Deadline als klein label, rood als hij verstreken is en zand-geel als hij binnen 7 dagen valt. */
function Deadline({ project, vandaag }: { project: Project; vandaag: string }) {
  const stand = deadlineStand(project.deadline, vandaag, project.status);
  if (!project.deadline || !stand) return <span className="pb-deadline is-geen">geen deadline</span>;
  const tekst = stand === 'telaat' ? `te laat · ${dagTekst(project.deadline, vandaag)}` : dagTekst(project.deadline, vandaag);
  return (
    <span className={`pb-deadline is-${stand}`} title={`Deadline ${project.deadline}`}>
      {tekst}
    </span>
  );
}

/** Statuskeuze op een kaart of regel: een gewone keuzelijst (toetsenbord, telefoon). */
function StatusKeuze({ project, onStatus }: { project: Project; onStatus: KaartProps['onStatus'] }) {
  return (
    <select
      className={`pb-status kp-pil kp-pil-${project.status}`}
      aria-label={`Status van ${project.naam}`}
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

function InStatus({ project, moment }: { project: Project; moment: Date }) {
  const d = dagenSinds(project.statusSinds, moment);
  if (d === null) return null;
  return (
    <span className="pb-sinds" title={`In deze status sinds ${korteDatum(project.statusSinds as string)}`}>
      {d === 0 ? 'sinds vandaag' : `${dagenTekst(d)} in deze status`}
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
  return (
    <article
      className={`pb-kaart${sleept ? ' is-sleept' : ''}${p.status === 'afgerond' ? ' is-af' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-project', p.id);
        e.dataTransfer.effectAllowed = 'move';
        onSleep(p.id);
      }}
      onDragEnd={() => onSleep(null)}
      onKeyDown={(e) => onToets(e, p)}
    >
      <Link className="pb-kaart-link" href={`/projecten/${p.id}`} draggable={false}>
        {p.naam}
      </Link>
      <p className="pb-kaart-klant">{p.klantNaam ?? 'Zonder klant'}</p>
      <div className="pb-kaart-rij">
        <Deadline project={p} vandaag={vandaag} />
        <span className="kp-eigenaren">
          {p.eigenaren.map((u) => (
            <Persoon key={u} id={u} compact voorvoegsel="eigenaar" />
          ))}
        </span>
      </div>
      {p.totaalTaken > 0 && <Voortgang open={p.openTaken} totaal={p.totaalTaken} />}
      <div className="pb-kaart-voet">
        <InStatus project={p} moment={moment} />
        <StatusKeuze project={p} onStatus={onStatus} />
      </div>
    </article>
  );
}

function ProjectRegel({ project: p, vandaag, moment, onStatus, onToets }: KaartProps) {
  return (
    <article className={`pb-regel${p.status === 'afgerond' ? ' is-af' : ''}`} onKeyDown={(e) => onToets(e, p)}>
      <span className="kp-rij-hoofd">
        <Link className="pb-kaart-link kp-rij-titel" href={`/projecten/${p.id}`}>
          {p.naam}
        </Link>
        <span className="kp-rij-sub">
          {p.klantNaam ?? 'Zonder klant'}
          {p.statusSinds && (
            <>
              {' · '}
              <InStatus project={p} moment={moment} />
            </>
          )}
        </span>
      </span>
      <span className="pb-regel-meta">
        <Deadline project={p} vandaag={vandaag} />
        <span className="kp-eigenaren">
          {p.eigenaren.map((u) => (
            <Persoon key={u} id={u} compact voorvoegsel="eigenaar" />
          ))}
        </span>
        <Voortgang open={p.openTaken} totaal={p.totaalTaken} />
        <StatusKeuze project={p} onStatus={onStatus} />
      </span>
    </article>
  );
}
