'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { captionSamenstellen, formatGepland } from '@/lib/social/kern';
import { formatGetal, kortCaption, postNaam } from '@/lib/social/weergave';
import type { Platform, PostDto } from '@/lib/social/types';
import { Icoon, PlatformIcoon } from './Iconen';
import { StatusPil } from './StatusPil';
import { Voorbeeld } from './Voorbeeld';

/** Het beeld van een post: het eerste eigen bestand, anders het beeld dat Meta toont (externe posts). */
export function beeldVan(post: PostDto): { url: string; video: boolean } | null {
  const eerste = post.media[0];
  if (eerste?.type === 'afbeelding' && eerste.url) return { url: eerste.url, video: false };
  const meta = post.kanalen.find((k) => k.beeld_url)?.beeld_url;
  if (meta) return { url: meta, video: eerste?.type === 'video' || post.soort === 'reel' };
  return null;
}

/** Miniatuur van een post: het eerste beeld, een video- of tekstvlak. */
export function PostThumb({ post, klein = false }: { post: PostDto; klein?: boolean }) {
  const eerste = post.media[0];
  const beeld = beeldVan(post);
  return (
    <span className={`so-thumb${klein ? ' so-thumb-klein' : ''}`} aria-hidden="true">
      {beeld ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL uit de privé-bucket of CDN-URL van Meta
        <img src={beeld.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="so-thumb-leeg">
          <Icoon naam={eerste?.type === 'video' || post.soort === 'reel' ? 'video' : post.soort === 'tekst' ? 'tekst' : 'beeld'} grootte={klein ? 16 : 22} />
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

/** Kerncijfers van een geplaatste post: weergaven, likes, reacties (met icoon). */
export function Kerncijfers({ post }: { post: PostDto }) {
  const c = post.inzichten;
  if (!c) return null;
  const items: { label: string; icoon: 'oog' | 'hart' | 'reactie'; waarde: number | undefined }[] = [
    { label: 'weergaven', icoon: 'oog', waarde: c.weergaven ?? c.bereik },
    { label: 'likes', icoon: 'hart', waarde: c.likes },
    { label: 'reacties', icoon: 'reactie', waarde: c.reacties }
  ];
  return (
    <dl className="so-cijfers">
      {items.map((i) => (
        <div key={i.label} title={i.waarde == null ? `${i.label}: (nog) niet beschikbaar` : `${i.waarde} ${i.label}`}>
          <dt>
            <Icoon naam={i.icoon} grootte={14} />
            <span className="so-sr">{i.label}</span>
          </dt>
          <dd>{formatGetal(i.waarde ?? null)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Een post in de lijst: het beeld groot (eerste slide), daaronder de titel en de cijfers. */
export function PostKaart({ post, nu, onOpnieuw, bezig }: { post: PostDto; nu: Date; onOpnieuw?: (p: PostDto) => void; bezig?: boolean }) {
  const fouten = [...new Set(post.kanalen.map((k) => k.fout).filter((f): f is string => !!f))];
  const titel = postNaam(post, 120);
  const beeld = beeldVan(post);
  const eerste = post.media[0];
  const geplaatst = post.status === 'geplaatst' || post.status === 'deels';
  return (
    <article className={`so-tegel so-kaart-${post.status}`}>
      <div className="so-tegel-beeld">
        {beeld ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL uit de privé-bucket of CDN-URL van Meta
          <img src={beeld.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : post.soort === 'tekst' && post.caption ? (
          <p className="so-tegel-tekstpost">{kortCaption(post.caption, 220)}</p>
        ) : (
          <span className="so-tegel-leeg" aria-hidden="true">
            <Icoon naam={eerste?.type === 'video' || post.soort === 'reel' ? 'video' : post.soort === 'tekst' ? 'tekst' : 'beeld'} grootte={28} />
          </span>
        )}
        <span className="so-tegel-boven">
          {!geplaatst && <StatusPil status={post.status} />}
          <span className="so-tegel-soort">
            {(post.soort === 'reel' || beeld?.video) && <Icoon naam="video" grootte={13} />}
            {post.media.length > 1 && <span>1/{post.media.length}</span>}
          </span>
        </span>
        <span className="so-tegel-kanalen">
          <Kanaaliconen post={post} />
        </span>
        <PostVoorbeeldKnop post={post} titel={titel} />
      </div>
      <div className="so-tegel-tekst">
        <Link className="so-kaart-link" href={`/social/${post.id}`}>
          {titel}
        </Link>
        <p className="so-kaart-moment">
          {momentTekst(post, nu)}
          {post.bron === 'extern' && <span className="so-zacht"> · buiten het dashboard</span>}
        </p>
        {geplaatst && <Kerncijfers post={post} />}
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
