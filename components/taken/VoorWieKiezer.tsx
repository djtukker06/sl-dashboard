'use client';

import type { CSSProperties } from 'react';
import { useTeam } from '@/components/team/TeamProvider';
import type { TeamProfiel } from '@/lib/team/types';

/**
 * "Voor wie": avatar-chips van de teamleden, meerdere tegelijk aan te zetten, plus de
 * snelkeuze "Iedereen". Minstens één blijft gekozen (de laatste kun je niet uitzetten).
 * Ook gebruikt voor de deelnemers van een afspraak.
 */
export function VoorWieKiezer({
  waarde,
  onChange,
  uitgeschakeld = false,
  label = 'Voor wie'
}: {
  waarde: string[];
  onChange: (ids: string[]) => void;
  uitgeschakeld?: boolean;
  label?: string;
}) {
  const { leden, perId, mijnId } = useTeam();
  // Actieve leden, plus wie er al in staat (bv. een oud-teamlid op een oude taak).
  const opties: TeamProfiel[] = [
    ...leden.filter((l) => l.actief),
    ...waarde.filter((id) => !leden.some((l) => l.actief && l.id === id)).map((id) => perId.get(id)).filter((p): p is TeamProfiel => !!p)
  ].sort((a, b) => Number(b.id === mijnId) - Number(a.id === mijnId));
  const actieveIds = opties.filter((o) => o.actief).map((o) => o.id);
  const iedereen = actieveIds.length > 1 && actieveIds.every((id) => waarde.includes(id));

  function wissel(id: string) {
    if (waarde.includes(id)) {
      if (waarde.length === 1) return; // minstens één
      onChange(waarde.filter((x) => x !== id));
    } else onChange([...waarde, id]);
  }

  return (
    <div className="tk-wie" role="group" aria-label={label}>
      {opties.map((p) => {
        const aan = waarde.includes(p.id);
        const naam = p.id === mijnId ? `${p.voornaam || p.naam} (jij)` : p.voornaam || p.naam;
        return (
          <button
            key={p.id}
            type="button"
            className={`tk-wie-chip${aan ? ' is-aan' : ''}${p.actief ? '' : ' is-oud'}`}
            aria-pressed={aan}
            disabled={uitgeschakeld || (aan && waarde.length === 1)}
            title={aan && waarde.length === 1 ? 'Minstens één persoon' : p.naam}
            onClick={() => wissel(p.id)}
            style={{ '--sl-avatar-kleur': p.kleur } as CSSProperties}
          >
            <span className="tk-wie-avatar" aria-hidden="true">
              {p.initialen}
            </span>
            <span className="tk-wie-naam">{naam}</span>
          </button>
        );
      })}
      {actieveIds.length > 1 && !uitgeschakeld && (
        <button
          type="button"
          className={`tk-wie-alle${iedereen ? ' is-aan' : ''}`}
          aria-pressed={iedereen}
          onClick={() => onChange(iedereen ? [mijnId] : actieveIds)}
        >
          Iedereen
        </button>
      )}
    </div>
  );
}
