'use client';

import type { CSSProperties } from 'react';
import type { Wie } from '@/lib/agenda/types';
import { useActieveLeden, useTeam } from '@/components/team/TeamProvider';

/**
 * "Mijn agenda | Heel team", plus avatar-chips om op één teamlid te filteren.
 * Standaard zie je alleen je eigen taken en afspraken.
 */
export function WieFilter({ waarde, onChange }: { waarde: Wie; onChange: (w: Wie) => void }) {
  const { mijnId } = useTeam();
  const anderen = useActieveLeden().filter((l) => l.id !== mijnId);
  const persoon = waarde !== 'ik' && waarde !== 'team' ? waarde : null;

  return (
    <div className="ag-wie-filter" role="group" aria-label="Wiens agenda">
      <div className="ag-segment">
        <button type="button" aria-pressed={waarde === 'ik'} className={waarde === 'ik' ? 'is-aan' : ''} onClick={() => onChange('ik')}>
          Mijn agenda
        </button>
        <button
          type="button"
          aria-pressed={waarde === 'team'}
          className={waarde === 'team' ? 'is-aan' : ''}
          onClick={() => onChange('team')}
          disabled={!anderen.length && waarde !== 'team'}
          title={anderen.length ? 'Taken en afspraken van iedereen' : 'Nog geen andere teamleden'}
        >
          Heel team
        </button>
      </div>
      {anderen.length > 0 && (
        <div className="ag-wie-personen">
          {anderen.map((p) => {
            const aan = persoon === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`tk-wie-chip tk-wie-chip-klein${aan ? ' is-aan' : ''}`}
                aria-pressed={aan}
                title={aan ? `Alleen ${p.naam} (klik voor heel team)` : `Alleen ${p.naam}`}
                style={{ '--sl-avatar-kleur': p.kleur } as CSSProperties}
                onClick={() => onChange(aan ? 'team' : p.id)}
              >
                <span className="tk-wie-avatar" aria-hidden="true">
                  {p.initialen}
                </span>
                <span className="tk-wie-naam">{p.voornaam || p.naam}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
