'use client';

import type { CSSProperties } from 'react';
import { useTeam } from './TeamProvider';

// Een teamlid als avatar (+ naam): voor "aangemaakt door", toegewezenen en uploaders.
//   <Persoon id={…} />            avatar + naam ("jij" als jij het bent)
//   <Persoon id={…} compact />    alleen de avatar (naam als tooltip)
//   <Persoon id={…} voorvoegsel="van" />   "van Mark"
// Onbekend of leeg id: niets.
export function Persoon({
  id,
  compact = false,
  voorvoegsel,
  className
}: {
  id: string | null | undefined;
  compact?: boolean;
  voorvoegsel?: string;
  className?: string;
}) {
  const { perId, mijnId } = useTeam();
  if (!id) return null;
  const p = perId.get(id);
  if (!p) return null;
  const naam = id === mijnId ? 'jij' : p.voornaam || p.naam;
  const stijl = { '--sl-avatar-kleur': p.kleur, '--sl-avatar-tekst': '#232323' } as CSSProperties;
  return (
    <span
      className={`sl-persoon${compact ? ' sl-persoon-compact' : ''}${className ? ` ${className}` : ''}`}
      title={compact ? `${voorvoegsel ? `${voorvoegsel} ` : ''}${p.naam}` : undefined}
    >
      <span className="sl-persoon-avatar" style={stijl} aria-hidden={compact ? undefined : true}>
        {p.initialen}
      </span>
      {compact ? (
        <span className="sr-only">{`${voorvoegsel ? `${voorvoegsel} ` : ''}${p.naam}`}</span>
      ) : (
        <span className="sl-persoon-naam">{voorvoegsel ? `${voorvoegsel} ${naam}` : naam}</span>
      )}
    </span>
  );
}
