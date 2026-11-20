'use client';

import { useState, type CSSProperties } from 'react';
import { AVATAR_FOTO_KLASSE } from '@/lib/team/foto';

// Avatar van een teamlid: de profielfoto (migratie 0039) als die er is, anders de initialen.
// De foto ligt óver de initialen (shell.css: .sl-avatar-foto), dus vorm,
// maat, rand en kleurring blijven die van de class van de plek zelf (sl-avatar,
// sl-persoon-avatar, …). Laadt de foto niet, dan verdwijnt hij en staan de initialen er weer.
//   <Avatar className="sl-persoon-avatar" initialen="DT" foto={p.foto} style={…} aria-hidden />
export function Avatar({
  initialen,
  foto,
  naam = '',
  className,
  style,
  'aria-hidden': ariaHidden
}: {
  initialen: string;
  foto?: string | null;
  /** Alt-tekst van de foto; leeg laten als de avatar aria-hidden is (de naam staat ernaast). */
  naam?: string;
  className: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean | 'true';
}) {
  // Per URL onthouden: een nieuwe foto krijgt een nieuwe kans.
  const [mislukt, setMislukt] = useState<string | null>(null);
  const toon = foto && mislukt !== foto ? foto : null;
  return (
    <span className={className} style={style} aria-hidden={ariaHidden}>
      {initialen}
      {toon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={AVATAR_FOTO_KLASSE}
          src={toon}
          alt={ariaHidden ? '' : naam}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setMislukt(toon)}
        />
      )}
    </span>
  );
}
