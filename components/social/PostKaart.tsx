'use client';

import Link from 'next/link';
import { SOORT_LABEL, formatGepland } from '@/lib/social/kern';
import { formatGetal, kortCaption } from '@/lib/social/weergave';
import type { PostDto } from '@/lib/social/types';
import { Icoon, PlatformIcoon } from './Iconen';
import { StatusPil } from './StatusPil';

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
  const titel = kortCaption(post.caption, 140) || (post.media.length ? SOORT_LABEL[post.soort] : 'Lege post');
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
    </article>
  );
}
