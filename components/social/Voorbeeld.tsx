'use client';

import { useState } from 'react';
import { voorbeeldVerhouding } from '@/lib/social/weergave';
import type { Platform, PostSoort } from '@/lib/social/types';
import { Icoon, PlatformIcoon } from './Iconen';

export interface VoorbeeldMedia {
  sleutel: string;
  type: 'afbeelding' | 'video';
  /** Signed URL (afbeelding) of een lokale blob-URL (net gekozen bestand). */
  url: string | null;
  breedte: number | null;
  hoogte: number | null;
  alt: string;
}

// Live voorbeeld van de post zoals hij in de feed staat: Instagram (beeld 1:1 t/m 4:5 of
// 9:16 voor een reel, caption onder het beeld, eerste reactie eronder) of een Facebookpagina.
// Een benadering: de echte weergave verschilt per app en schermgrootte.
export function Voorbeeld({
  platform,
  naam,
  afbeelding,
  soort,
  media,
  caption,
  eersteReactie,
  locatie,
  collaborators
}: {
  platform: Platform;
  naam: string;
  afbeelding: string | null;
  soort: PostSoort;
  media: VoorbeeldMedia[];
  caption: string;
  eersteReactie: string;
  locatie: string | null;
  collaborators: string[];
}) {
  const [index, setIndex] = useState(0);
  const i = Math.min(index, Math.max(0, media.length - 1));
  const huidig = media[i];
  const verhouding = voorbeeldVerhouding(soort, media[0] ?? null);
  const [uitgeklapt, setUitgeklapt] = useState(false);
  const lang = [...caption].length > 125 || caption.split('\n').length > 2;

  const avatar = (
    <span className="so-vb-avatar" aria-hidden="true">
      {afbeelding ? (
        // eslint-disable-next-line @next/next/no-img-element -- profielfoto van Meta
        <img src={afbeelding} alt="" />
      ) : (
        <PlatformIcoon platform={platform} grootte={14} />
      )}
    </span>
  );

  const beeld =
    soort === 'tekst' ? null : (
      <div className="so-vb-beeld" style={{ aspectRatio: String(verhouding) }}>
        {huidig?.url && huidig.type === 'afbeelding' ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL of lokaal voorbeeld
          <img src={huidig.url} alt={huidig.alt} />
        ) : huidig?.url && huidig.type === 'video' ? (
          <video src={huidig.url} muted loop playsInline autoPlay aria-label={huidig.alt || 'Video'} />
        ) : (
          <span className="so-vb-leeg">
            <Icoon naam={huidig?.type === 'video' ? 'video' : 'beeld'} grootte={28} />
            <span>{huidig ? (huidig.type === 'video' ? 'Video' : 'Afbeelding') : soort === 'reel' ? 'Voeg een video toe' : 'Voeg een afbeelding toe'}</span>
          </span>
        )}
        {media.length > 1 && (
          <>
            {i > 0 && (
              <button type="button" className="so-vb-pijl is-links" aria-label="Vorige" onClick={() => setIndex(i - 1)}>
                <Icoon naam="links" grootte={14} />
              </button>
            )}
            {i < media.length - 1 && (
              <button type="button" className="so-vb-pijl is-rechts" aria-label="Volgende" onClick={() => setIndex(i + 1)}>
                <Icoon naam="rechts" grootte={14} />
              </button>
            )}
            <span className="so-vb-teller">
              {i + 1}/{media.length}
            </span>
          </>
        )}
      </div>
    );

  if (platform === 'facebook') {
    return (
      <div className="so-vb so-vb-fb" aria-label="Voorbeeld op Facebook">
        <div className="so-vb-kop">
          {avatar}
          <span className="so-vb-naam">
            <strong>{naam}</strong>
            <span className="so-zacht">Zojuist · openbaar{locatie ? ` · ${locatie}` : ''}</span>
          </span>
        </div>
        {caption && <p className="so-vb-tekst so-vb-fb-tekst">{caption}</p>}
        {beeld}
        <div className="so-vb-fb-acties">
          <span>Vind ik leuk</span>
          <span>Reageren</span>
          <span>Delen</span>
        </div>
        {eersteReactie && (
          <p className="so-vb-reactie">
            <strong>{naam}</strong> {eersteReactie}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="so-vb so-vb-ig" aria-label="Voorbeeld op Instagram">
      <div className="so-vb-kop">
        {avatar}
        <span className="so-vb-naam">
          <strong>
            {naam}
            {collaborators.length > 0 && <> en {collaborators.length === 1 ? collaborators[0] : `${collaborators.length} anderen`}</>}
          </strong>
          {locatie && <span className="so-zacht">{locatie}</span>}
        </span>
      </div>
      {beeld}
      {media.length > 1 && (
        <div className="so-vb-stippen" aria-hidden="true">
          {media.map((m, n) => (
            <span key={m.sleutel} className={n === i ? 'is-aan' : ''} />
          ))}
        </div>
      )}
      <div className="so-vb-acties" aria-hidden="true">
        <Icoon naam="hart" grootte={20} />
        <Icoon naam="reactie" grootte={20} />
        <Icoon naam="deel" grootte={20} />
        <span className="so-vb-acties-rechts">
          <Icoon naam="bewaar" grootte={20} />
        </span>
      </div>
      {caption && (
        <p className={`so-vb-tekst${lang && !uitgeklapt ? ' is-kort' : ''}`}>
          <strong>{naam}</strong> {caption}
        </p>
      )}
      {lang && !uitgeklapt && (
        <button type="button" className="so-vb-meer" onClick={() => setUitgeklapt(true)}>
          meer
        </button>
      )}
      {eersteReactie && (
        <p className="so-vb-reactie">
          <strong>{naam}</strong> {eersteReactie}
        </p>
      )}
    </div>
  );
}
