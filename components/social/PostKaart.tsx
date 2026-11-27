'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { SOORT_LABEL, captionSamenstellen, formatGepland } from '@/lib/social/kern';
import { formatGetal, kortCaption, postNaam } from '@/lib/social/weergave';
import type { Platform, PostDto } from '@/lib/social/types';
import { Icoon, PlatformIcoon } from './Iconen';
import { StatusPil } from './StatusPil';
import { Voorbeeld } from './Voorbeeld';

/** Miniatuur van een post: het eerste beeld, een video- of tekstvlak. */
export function PostThumb({ post, klein = false }: { post: PostDto; klein?: boolean }) {
  const eerste = post.media[0];
  return (
    <span className={`so-thumb${klein ? ' so-thumb-klein' : ''}`} aria-hidden="true">
      {eerste?.type === 'afbeelding' && eerste.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- kortlevende signed URL uit de privé-bucket
        <img src={eerste.url} alt="" loading="lazy" />
      ) : (
        <span className="so-thumb-leeg">
          <Icoon naam={eerste?.type === 'video' ? 'video' : post.soort === 'tekst' ? 'tekst' : 'beeld'} grootte={klein ? 16 : 22} />
        </span>
      )}
      {post.media.length > 1 && <span className="so-thumb-aantal">{post.media.length}</span>}
    </span>
  );
}

/** "Gepland donderdag 26 november 19:30", "Geplaatst …", "Concept · geen datum". */
export function momentTekst(post: PostDto, nu: Date): string {
  if (post.geplaatst_op) return `Geplaatst ${formatGepland(post.geplaatst_op, nu)}`;
  if (post.status === 'concept') return post.gepland_op ? `Concept · ${formatGepland(post.gepland_op, nu)}` : 'Concept · nog geen datum';
  if (post.gepland_op) return `${post.status === 'mislukt' ? 'Gepland voor' : 'Gepland'} ${formatGepland(post.gepland_op, nu)}`;
  return '';
}

export function Kanaaliconen({ post }: { post: PostDto }) {
  if (!post.kanalen.length) return <span className="so-kanalen so-zacht">Geen kanaal</span>;
  return (
    <span className="so-kanalen">
      {post.kanalen.map((k) => (
        <span key={k.id} className={`so-kanaal so-kanaal-${k.status}`} title={`${k.account_naam} (${k.platform === 'instagram' ? 'Instagram' : 'Facebook'})`}>
          <PlatformIcoon platform={k.platform} grootte={14} titel={k.account_naam} />
        </span>
      ))}
    </span>
  );
}

/** Kerncijfers van een geplaatste post: bereik, likes, reacties, opslagen. */
export function Kerncijfers({ post }: { post: PostDto }) {
  const c = post.inzichten;
  if (!c) return null;
  const items: [string, number | undefined][] = [
    ['bereik', c.bereik ?? c.weergaven],
    ['likes', c.likes],
    ['reacties', c.reacties],
    ['opslagen', c.opslagen]
  ];
  return (
    <dl className="so-cijfers">
      {items.map(([label, waarde]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatGetal(waarde ?? null)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PostKaart({ post, nu, onOpnieuw, bezig }: { post: PostDto; nu: Date; onOpnieuw?: (p: PostDto) => void; bezig?: boolean }) {
  const fouten = [...new Set(post.kanalen.map((k) => k.fout).filter((f): f is string => !!f))];
  const titel = postNaam(post, 140);
  // Met een eigen titel staat het begin van de caption eronder (zonder titel is de caption de titel).
  const onder = post.titel?.trim() ? kortCaption(post.caption, 160) : '';
  return (
    <article className={`so-kaart so-kaart-${post.status}`}>
      <PostThumb post={post} />
      <div className="so-kaart-tekst">
        <div className="so-kaart-boven">
          <StatusPil status={post.status} />
          <Kanaaliconen post={post} />
          <span className="so-kaart-soort">{SOORT_LABEL[post.soort]}</span>
          {post.bron === 'extern' && <span className="so-kaart-soort">Buiten het dashboard geplaatst</span>}
        </div>
        <Link className="so-kaart-link" href={`/social/${post.id}`}>
          {titel}
        </Link>
        {onder && <p className="so-kaart-caption">{onder}</p>}
        <p className="so-kaart-moment">{momentTekst(post, nu)}</p>
        {(post.status === 'geplaatst' || post.status === 'deels') && <Kerncijfers post={post} />}
        {(post.status === 'mislukt' || post.status === 'deels') && (
          <div className="so-kaart-fout">
            {fouten.length ? fouten.map((f) => <p key={f}>{f}</p>) : <p>Plaatsen is niet gelukt.</p>}
            {onOpnieuw && (
              <button type="button" className="db-knop" onClick={() => onOpnieuw(post)} disabled={bezig}>
                {bezig ? 'Bezig…' : 'Opnieuw proberen'}
              </button>
            )}
          </div>
        )}
      </div>
      <PostVoorbeeldKnop post={post} titel={titel} />
    </article>
  );
}

/** Knop "Voorbeeld": de post zoals hij in de feed staat, in een venster (per kanaal te wisselen). */
export function PostVoorbeeldKnop({ post, titel }: { post: PostDto; titel: string }) {
  const venster = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const platforms = [...new Set(post.kanalen.map((k) => k.platform))];
  const [keuze, setKeuze] = useState<Platform>(platforms[0] ?? (post.soort === 'tekst' ? 'facebook' : 'instagram'));
  const kanaal = post.kanalen.find((k) => k.platform === keuze);
  const tekst = captionSamenstellen(post, kanaal?.caption_eigen);

  function openen() {
    setOpen(true);
    venster.current?.showModal();
  }
  function sluiten() {
    venster.current?.close();
  }

  return (
    <>
      <button type="button" className="so-kaart-vb" onClick={openen} aria-label={`Voorbeeld van ${titel}`} title="Voorbeeld">
        <Icoon naam="oog" grootte={16} />
      </button>
      <dialog
        ref={venster}
        className="so-vb-venster"
        aria-label={`Voorbeeld: ${titel}`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === venster.current) sluiten();
        }}
      >
        <div className="so-vb-venster-kop">
          <strong>{titel}</strong>
          <button type="button" className="db-knop db-knop-klein" onClick={sluiten}>
            Sluiten
          </button>
        </div>
        {platforms.length > 1 && (
          <div className="ag-segment so-vb-venster-keuze" role="group" aria-label="Kanaal">
            {platforms.map((pl) => (
              <button key={pl} type="button" className={keuze === pl ? 'is-aan' : ''} aria-pressed={keuze === pl} onClick={() => setKeuze(pl)}>
                {pl === 'instagram' ? 'Instagram' : 'Facebook'}
              </button>
            ))}
          </div>
        )}
        {open && (
          <Voorbeeld
            key={keuze}
            platform={keuze}
            naam={kanaal?.account_gebruikersnaam || kanaal?.account_naam || 'studiolevant'}
            afbeelding={null}
            soort={post.soort}
            media={post.media.map((m) => ({ sleutel: m.id, type: m.type, url: m.url, breedte: m.breedte, hoogte: m.hoogte, alt: m.alt_tekst }))}
            caption={tekst.caption}
            eersteReactie={tekst.eersteReactie}
            locatie={post.locatie_id ? post.locatie_naam || null : null}
            collaborators={keuze === 'instagram' ? post.collaborators : []}
          />
        )}
      </dialog>
    </>
  );
}
