'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/agenda/Toast';
import { Persoon } from '@/components/team/Persoon';
import { useTeam } from '@/components/team/TeamProvider';
import { korteDatum } from '@/lib/dashboard/tijd';
import type { KlantNotitie } from '@/lib/crm/types';
import { crmApi } from './CrmDialoog';

/** Korte notities bij een klant: tekstvak + "Toevoegen", daaronder de tijdlijn (nieuwste eerst). */
export function KlantNotities({ klantId, notities }: { klantId: string; notities: KlantNotitie[] }) {
  const router = useRouter();
  const toast = useToast();
  const { mijnId } = useTeam();
  const [tekst, setTekst] = useState('');
  const [bezig, setBezig] = useState(false);
  const [weg, setWeg] = useState<Set<string>>(new Set());

  async function voegToe(e: React.FormEvent) {
    e.preventDefault();
    if (!tekst.trim()) return;
    setBezig(true);
    try {
      await crmApi(`/api/klanten/${klantId}/notities`, 'POST', { tekst });
      setTekst('');
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Niet gelukt.', { fout: true });
    } finally {
      setBezig(false);
    }
  }

  async function verwijder(n: KlantNotitie) {
    setWeg((s) => new Set(s).add(n.id));
    try {
      await crmApi(`/api/klanten/${klantId}/notities/${n.id}`, 'DELETE');
      router.refresh();
    } catch (err) {
      setWeg((s) => {
        const x = new Set(s);
        x.delete(n.id);
        return x;
      });
      toast(err instanceof Error ? err.message : 'Niet gelukt.', { fout: true });
    }
  }

  const zichtbaar = notities.filter((n) => !weg.has(n.id));
  return (
    <div className="kp-notities">
      <form className="kp-notitie-nieuw" onSubmit={voegToe}>
        <textarea
          className="ag-veld"
          rows={2}
          maxLength={2000}
          placeholder="Bijv. Gebeld over de offerte, belt volgende week terug"
          aria-label="Nieuwe notitie"
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="db-knop" disabled={bezig || !tekst.trim()}>
          {bezig ? 'Bezig…' : 'Toevoegen'}
        </button>
      </form>
      {zichtbaar.length === 0 ? (
        <p className="kp-leeg">Nog geen notities.</p>
      ) : (
        <ol className="kp-tijdlijn">
          {zichtbaar.map((n) => (
            <li key={n.id}>
              <p className="kp-tijdlijn-tekst">{n.tekst}</p>
              <p className="kp-tijdlijn-meta">
                <Persoon id={n.door} />
                <span>{korteDatum(n.op)}</span>
                {n.door === mijnId && (
                  <button type="button" className="kp-linkknop" onClick={() => void verwijder(n)}>
                    Verwijderen
                  </button>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
