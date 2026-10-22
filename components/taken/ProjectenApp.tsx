'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';
import type { Project } from '@/lib/agenda/types';
import { KlantKiezer } from '@/components/agenda/KlantKiezer';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Persoon } from '@/components/team/Persoon';
import { TaakKnop } from '@/components/dashboard/TaakKnop';
import { TakenProvider, useTaakDialoog, useTaakGebeurtenis } from './TakenProvider';

type Status = 'actief' | 'gearchiveerd';
type Klant = { id: string; naam: string } | null;

export function ProjectenApp() {
  return (
    <ToastProvider>
      <TakenProvider>
        <Projecten />
      </TakenProvider>
    </ToastProvider>
  );
}

function Projecten() {
  const toast = useToast();
  const { nieuw: nieuweTaak } = useTaakDialoog();
  const [status, setStatus] = useState<Status>('actief');
  const [lijst, setLijst] = useState<Project[] | null>(null);
  const [fout, setFout] = useState('');
  const [teller, setTeller] = useState(0);
  const [bewerk, setBewerk] = useState<string | null>(null);

  // Nieuw project
  const [naam, setNaam] = useState('');
  const [klant, setKlant] = useState<Klant>(null);
  const [bezig, setBezig] = useState(false);
  const [nieuwFout, setNieuwFout] = useState('');

  useEffect(() => {
    let weg = false;
    agendaApi
      .projecten('alle')
      .then((r) => {
        if (weg) return;
        setLijst(r.projecten);
        setFout('');
      })
      .catch((e) => !weg && setFout(e instanceof Error ? e.message : 'Projecten konden niet worden geladen.'));
    return () => {
      weg = true;
    };
  }, [teller]);
  const herlaad = useCallback(() => setTeller((t) => t + 1), []);
  useTaakGebeurtenis(herlaad);

  const zichtbaar = useMemo(() => (lijst ?? []).filter((p) => p.status === status), [lijst, status]);
  const groepen = useMemo(() => {
    const m = new Map<string, { titel: string; projecten: Project[] }>();
    for (const p of zichtbaar) {
      const sleutel = p.klantId ?? '';
      if (!m.has(sleutel)) m.set(sleutel, { titel: p.klantNaam ?? 'Zonder klant', projecten: [] });
      m.get(sleutel)!.projecten.push(p);
    }
    return [...m.entries()]
      .sort(([a, x], [b, y]) => (a === '' ? 1 : b === '' ? -1 : x.titel.localeCompare(y.titel, 'nl')))
      .map(([sleutel, g]) => ({ sleutel, ...g }));
  }, [zichtbaar]);
  const aantal = (s: Status) => (lijst ?? []).filter((p) => p.status === s).length;

  function vervang(p: Project) {
    setLijst((l) => (l ? l.map((x) => (x.id === p.id ? p : x)) : l));
  }

  async function maak(e: React.FormEvent) {
    e.preventDefault();
    const n = naam.replace(/\s+/g, ' ').trim();
    if (!n) {
      setNieuwFout('Geef het project een naam.');
      return;
    }
    setBezig(true);
    setNieuwFout('');
    try {
      const { project } = await agendaApi.maakProject({ naam: n, klantId: klant?.id ?? null });
      setLijst((l) => [...(l ?? []), project]);
      setStatus('actief');
      setNaam('');
      setKlant(null);
      toast(`Project ‘${project.naam}’ aangemaakt`, {
        actie: {
          label: '+ Taak',
          onClick: () =>
            nieuweTaak({ project: { id: project.id, naam: project.naam, klantId: project.klantId, klantNaam: project.klantNaam } })
        }
      });
    } catch (err) {
      setNieuwFout(err instanceof Error ? err.message : 'Aanmaken mislukt.');
    } finally {
      setBezig(false);
    }
  }

  async function zetStatus(p: Project, s: Status) {
    vervang({ ...p, status: s });
    try {
      const { project } = await agendaApi.wijzigProject(p.id, { status: s });
      vervang(project);
      toast(s === 'gearchiveerd' ? `‘${p.naam}’ gearchiveerd` : `‘${p.naam}’ teruggezet`, {
        actie: { label: 'Ongedaan maken', onClick: () => void zetStatus(project, p.status) }
      });
    } catch (err) {
      vervang(p);
      toast(err instanceof Error ? err.message : 'Niet gelukt.', { fout: true });
    }
  }

  return (
    <>
      <ModuleKop label={<Link href="/agenda">← Agenda &amp; taken</Link>} titel="Projecten">
        <TaakKnop />
      </ModuleKop>

      <div className="pj">
        <form className="pj-nieuw" onSubmit={maak} noValidate>
          <label className="ag-label">
            Nieuw project
            <input
              className="ag-veld"
              type="text"
              value={naam}
              maxLength={120}
              placeholder="Bijv. Huisstijl 2027"
              onChange={(e) => {
                setNaam(e.target.value);
                setNieuwFout('');
              }}
            />
          </label>
          <div className="ag-label">
            <span>Klant (optioneel)</span>
            <KlantKiezer waarde={klant} onChange={setKlant} />
          </div>
          <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
            {bezig ? 'Bezig…' : 'Toevoegen'}
          </button>
          {nieuwFout && (
            <p className="ag-fout" role="alert" style={{ gridColumn: '1 / -1' }}>
              {nieuwFout}
            </p>
          )}
        </form>

        <div className="pj-balk">
          <div className="ag-segment" role="group" aria-label="Welke projecten">
            {(['actief', 'gearchiveerd'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} className={status === s ? 'is-aan' : ''} onClick={() => setStatus(s)}>
                {s === 'actief' ? 'Actief' : 'Gearchiveerd'}
                {lijst ? ` · ${aantal(s)}` : ''}
              </button>
            ))}
          </div>
        </div>

        {fout ? (
          <div className="db-melding db-melding-fout" role="alert">
            <p className="db-melding-titel">Projecten niet geladen</p>
            <p className="db-melding-tekst">{fout}</p>
            <div className="db-melding-actie">
              <button type="button" className="db-knop" onClick={herlaad}>
                Opnieuw
              </button>
            </div>
          </div>
        ) : !lijst ? (
          <div className="ag-lijst-skelet" aria-busy="true" aria-label="Projecten laden">
            {[70, 52, 64].map((w) => (
              <div key={w} className="db-skelet" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : groepen.length === 0 ? (
          <div className="db-melding">
            <p className="db-melding-titel">{status === 'actief' ? 'Nog geen projecten' : 'Geen gearchiveerde projecten'}</p>
            <p className="db-melding-tekst">
              {status === 'actief'
                ? 'Maak hierboven een project aan, of direct vanuit de taak-popup (veld Project). Taken van een project zie je in de agenda.'
                : 'Gearchiveerde projecten verschijnen hier; hun taken blijven gewoon bestaan.'}
            </p>
          </div>
        ) : (
          groepen.map((g) => (
            <section key={g.sleutel} className="pj-groep" aria-label={g.titel}>
              <h2 className="pj-groep-kop">
                {g.titel}
                <span>{g.projecten.length}</span>
              </h2>
              <ul className="pj-lijst">
                {g.projecten.map((p) =>
                  bewerk === p.id ? (
                    <li key={p.id}>
                      <ProjectBewerk
                        project={p}
                        onKlaar={(nieuw) => {
                          setBewerk(null);
                          if (nieuw) {
                            vervang(nieuw);
                            toast('Project opgeslagen');
                          }
                        }}
                      />
                    </li>
                  ) : (
                    <li key={p.id} className={`pj-rij${p.status === 'gearchiveerd' ? ' is-gearchiveerd' : ''}`}>
                      <span className="pj-naam">
                        <Link href={`/agenda?wie=team&project=${p.id}`} title="Taken van dit project in de agenda">
                          {p.naam}
                        </Link>
                      </span>
                      <span className="pj-meta">
                        <span>
                          {p.openTaken} open {p.openTaken === 1 ? 'taak' : 'taken'}
                        </span>
                        <Persoon id={p.aangemaaktDoor} compact voorvoegsel="aangemaakt door" />
                      </span>
                      <span className="pj-acties">
                        {p.status === 'actief' && (
                          <button
                            type="button"
                            className="pj-knop"
                            onClick={() => nieuweTaak({ project: { id: p.id, naam: p.naam, klantId: p.klantId, klantNaam: p.klantNaam } })}
                          >
                            + Taak
                          </button>
                        )}
                        <button type="button" className="pj-knop" onClick={() => setBewerk(p.id)}>
                          Wijzigen
                        </button>
                        <button
                          type="button"
                          className="pj-knop"
                          onClick={() => void zetStatus(p, p.status === 'actief' ? 'gearchiveerd' : 'actief')}
                        >
                          {p.status === 'actief' ? 'Archiveren' : 'Terugzetten'}
                        </button>
                      </span>
                    </li>
                  )
                )}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function ProjectBewerk({ project, onKlaar }: { project: Project; onKlaar: (p: Project | null) => void }) {
  const [naam, setNaam] = useState(project.naam);
  const [klant, setKlant] = useState<Klant>(project.klantId ? { id: project.klantId, naam: project.klantNaam ?? 'Klant' } : null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');

  async function opslaan(e?: React.FormEvent) {
    e?.preventDefault();
    if (!naam.trim()) {
      setFout('Geef het project een naam.');
      return;
    }
    setBezig(true);
    setFout('');
    try {
      const { project: p } = await agendaApi.wijzigProject(project.id, { naam, klantId: klant?.id ?? null });
      onKlaar(p);
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <form
      className="pj-bewerk"
      onSubmit={opslaan}
      noValidate
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onKlaar(null);
        }
      }}
    >
      <input
        className="ag-veld"
        type="text"
        aria-label="Naam van het project"
        value={naam}
        maxLength={120}
        autoFocus
        onChange={(e) => setNaam(e.target.value)}
      />
      <KlantKiezer waarde={klant} onChange={setKlant} />
      <span className="pj-bewerk-acties">
        <button type="button" className="db-knop" onClick={() => onKlaar(null)}>
          Annuleren
        </button>
        <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
          {bezig ? 'Bezig…' : 'Opslaan'}
        </button>
      </span>
      {fout && (
        <p className="ag-fout" role="alert" style={{ gridColumn: '1 / -1' }}>
          {fout}
        </p>
      )}
    </form>
  );
}
