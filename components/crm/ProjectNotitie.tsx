'use client';

import { useEffect, useRef, useState } from 'react';
import { agendaApi } from '@/lib/agenda/client';

/** Eén notitieveld per project dat vanzelf opslaat (even na het typen, en bij verlaten). */
export function ProjectNotitie({ projectId, start }: { projectId: string; start: string }) {
  const [tekst, setTekst] = useState(start);
  const [stand, setStand] = useState<'' | 'bezig' | 'opgeslagen' | 'fout'>('');
  const opgeslagen = useRef(start);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function bewaar(t: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (t === opgeslagen.current) return;
    setStand('bezig');
    try {
      await agendaApi.wijzigProject(projectId, { notitie: t });
      opgeslagen.current = t;
      setStand('opgeslagen');
    } catch {
      setStand('fout');
    }
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="kp-notitieveld">
      <textarea
        className="ag-veld"
        rows={8}
        maxLength={5000}
        aria-label="Notities bij dit project"
        placeholder="Afspraken, links, wat de klant wil…"
        value={tekst}
        onChange={(e) => {
          const t = e.target.value;
          setTekst(t);
          setStand('');
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void bewaar(t), 900);
        }}
        onBlur={() => void bewaar(tekst)}
      />
      <p className={`kp-opslagstand${stand === 'fout' ? ' is-fout' : ''}`} role="status" aria-live="polite">
        {stand === 'bezig' ? 'Opslaan…' : stand === 'opgeslagen' ? 'Opgeslagen' : stand === 'fout' ? 'Niet opgeslagen. Probeer het opnieuw.' : ' '}
      </p>
    </div>
  );
}
