'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PLATFORM_LABEL, SOORT_LABEL, formatGepland } from '@/lib/social/kern';
import {
  DAGDELEN,
  PERIODES,
  WEEKDAG_LANG,
  bestePosts,
  dagMaand,
  dagdeel,
  formatGetal,
  interacties,
  kortCaption,
  lijnPad,
  optellen,
  perGroep,
  periodeBereik,
  volgersReeks,
  weekdagVan,
  type GroepCijfer,
  type Periode
} from '@/lib/social/weergave';
import type { InzichtenAntwoord, PostDto, PostInzichtDto, PostsAntwoord } from '@/lib/social/types';
import { api, foutTekst } from './api';
import { PlatformIcoon } from './Iconen';
import { PostThumb } from './PostKaart';

type Rij = PostInzichtDto & { post: PostDto | null };

// Analytics per periode (7/30/90 dagen): totalen, volgersgroei (lijn), beste posts, en
// gemiddelden per soort, weekdag en dagdeel. Leest GET /api/social/inzichten (cijfers) en
// GET /api/social/posts (soort, caption, beeld van dezelfde posts). Eenvoudige SVG/CSS-
// grafieken, geen chart-library.
export function Analytics() {
  const [periode, setPeriode] = useState<Periode>(30);
  const [data, setData] = useState<{ inzichten: InzichtenAntwoord; posts: PostDto[] } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [laden, setLaden] = useState(true);

  useEffect(() => {
    let weg = false;
    const { van, tot } = periodeBereik(periode, new Date());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- laadstaat bij een andere periode
    setLaden(true);
    Promise.all([
      api<InzichtenAntwoord>(`/api/social/inzichten?van=${van}&tot=${tot}`),
      api<PostsAntwoord>(`/api/social/posts?status=geplaatst&van=${van}&tot=${tot}`)
    ])
      .then(([inzichten, posts]) => {
        if (weg) return;
        setData({ inzichten, posts: posts.posts });
        setFout(null);
      })
      .catch((e) => !weg && setFout(foutTekst(e)))
      .finally(() => !weg && setLaden(false));
    return () => {
      weg = true;
    };
  }, [periode]);

  const rijen: Rij[] = useMemo(() => {
    if (!data) return [];
    const perId = new Map(data.posts.map((p) => [p.id, p]));
    return data.inzichten.posts.map((r) => ({ ...r, post: r.post_id ? (perId.get(r.post_id) ?? null) : null }));
  }, [data]);

  const totaal = optellen(rijen.map((r) => r.cijfers));
  const volgers = data ? volgersReeks(data.inzichten.accounts) : [];
  const groei = volgers.length > 1 ? volgers[volgers.length - 1].volgers - volgers[0].volgers : null;
  const accountBereik = data ? data.inzichten.accounts.flatMap((a) => a.reeks).reduce((s, r) => s + (r.bereik ?? 0), 0) : 0;
  const leeg = !!data && !rijen.length && !volgers.length;
  const melding = data?.inzichten.melding;

  return (
    <div className="so-inhoud">
      <div className="so-balk">
        <div className="ag-segment" role="group" aria-label="Periode">
          {PERIODES.map((p) => (
            <button key={p} type="button" className={periode === p ? 'is-aan' : ''} aria-pressed={periode === p} onClick={() => setPeriode(p)}>
              {p} dagen
            </button>
          ))}
        </div>
        {data && (
          <span className="so-zacht">
            {dagMaand(data.inzichten.van)} t/m {dagMaand(data.inzichten.tot)}
          </span>
        )}
      </div>

      {melding && (
        <p className="so-melding" role="status">
          <strong>Social is nog niet ingericht.</strong> {melding}
        </p>
      )}
      {fout && (
        <p className="so-melding" role="alert">
          {fout}
        </p>
      )}

      {laden && !data ? (
        <div className="so-laden" aria-busy="true">
          <div className="db-skelet db-skelet-groot" />
          <div className="db-skelet" />
        </div>
      ) : toonLeeg(leeg, melding) ? (
        <div className="so-leeg">
          <p className="db-melding-titel">Nog geen cijfers in deze periode</p>
          <p className="db-melding-tekst">
            Cijfers komen binnen zodra er een account gekoppeld is en de synchronisatie ze bij Meta heeft opgehaald (bereik, weergaven, likes, reacties,
            opslagen, volgers). Dat gebeurt vanzelf; via <Link href="/social/koppelingen">Koppelingen</Link> kun je ook nu synchroniseren. Posts die je buiten
            het dashboard plaatste, tellen ook mee.
          </p>
        </div>
      ) : data ? (
        <div className={`so-analytics${laden ? ' is-laden' : ''}`}>
          <dl className="so-tegels">
            <Tegel label="Bereik" waarde={totaal.bereik ?? (accountBereik || undefined)} />
            <Tegel label="Weergaven" waarde={totaal.weergaven} />
            <Tegel label="Likes" waarde={totaal.likes} />
            <Tegel label="Reacties" waarde={totaal.reacties} />
            <Tegel label="Opslagen" waarde={totaal.opslagen} />
            <Tegel label="Volgers erbij" waarde={groei ?? totaal.volgers_erbij} plus />
          </dl>

          <section className="db-kaart so-grafiek" aria-label="Volgers">
            <header className="db-kaart-kop">
              <h2 className="db-label">Volgers</h2>
              {volgers.length > 0 && <span className="so-zacht">{formatGetal(volgers[volgers.length - 1].volgers)} nu</span>}
            </header>
            <div className="db-kaart-inhoud">
              {volgers.length > 1 ? <Lijn punten={volgers.map((v) => ({ label: v.datum, waarde: v.volgers }))} /> : <p className="so-zacht">Nog te weinig dagen gemeten voor een lijn.</p>}
            </div>
          </section>

          <section className="db-kaart" aria-label="Beste posts">
            <header className="db-kaart-kop">
              <h2 className="db-label">Beste posts</h2>
              <span className="so-zacht">op bereik</span>
            </header>
            <div className="db-kaart-inhoud">
              {rijen.length ? (
                <ol className="so-top">
                  {bestePosts(rijen, 5).map((r) => {
                    const acc = data.inzichten.accounts.find((a) => a.account.id === r.account_id)?.account;
                    const inhoud = (
                      <>
                        {r.post ? <PostThumb post={r.post} klein /> : <span className="so-thumb so-thumb-klein" aria-hidden="true" />}
                        <span className="so-top-tekst">
                          <span>{kortCaption(r.post?.caption ?? '', 90) || (r.post ? SOORT_LABEL[r.post.soort] : 'Post buiten het dashboard')}</span>
                          <span className="so-zacht">
                            {acc && <PlatformIcoon platform={acc.platform} grootte={11} titel={PLATFORM_LABEL[acc.platform]} />}{' '}
                            {r.geplaatst_op ? formatGepland(r.geplaatst_op) : ''}
                          </span>
                        </span>
                        <span className="so-top-cijfer">
                          <strong>{formatGetal(r.cijfers.bereik ?? r.cijfers.weergaven ?? 0)}</strong>
                          <span className="so-zacht">{formatGetal(interacties(r.cijfers))} interacties</span>
                        </span>
                      </>
                    );
                    return (
                      <li key={`${r.account_id}-${r.extern_post_id}`}>
                        {r.post ? (
                          <Link href={`/social/${r.post.id}`} className="so-top-rij">
                            {inhoud}
                          </Link>
                        ) : r.permalink ? (
                          <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="so-top-rij">
                            {inhoud}
                          </a>
                        ) : (
                          <span className="so-top-rij">{inhoud}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="so-zacht">Geen geplaatste posts in deze periode.</p>
              )}
            </div>
          </section>

          <section className="db-kaart" aria-label="Per soort">
            <header className="db-kaart-kop">
              <h2 className="db-label">Per soort</h2>
              <span className="so-zacht">gemiddeld per post</span>
            </header>
            <div className="db-kaart-inhoud">
              <Staven
                groepen={perGroep(rijen, (r) => r.post?.soort ?? null, ['foto', 'carrousel', 'reel', 'tekst']).filter((g) => g.groep !== 'tekst' || g.aantal)}
                label={(g) => SOORT_LABEL[g as keyof typeof SOORT_LABEL]}
              />
            </div>
          </section>

          <section className="db-kaart" aria-label="Per dag van de week">
            <header className="db-kaart-kop">
              <h2 className="db-label">Per dag</h2>
              <span className="so-zacht">gemiddeld bereik</span>
            </header>
            <div className="db-kaart-inhoud">
              <Staven groepen={perGroep(rijen, (r) => (r.geplaatst_op ? weekdagVan(r.geplaatst_op) : null), WEEKDAG_LANG)} label={(g) => g} />
            </div>
          </section>

          <section className="db-kaart" aria-label="Per tijdstip">
            <header className="db-kaart-kop">
              <h2 className="db-label">Per tijdstip</h2>
              <span className="so-zacht">ochtend 6–12 · middag 12–17 · avond 17–23</span>
            </header>
            <div className="db-kaart-inhoud">
              <Staven groepen={perGroep(rijen, (r) => (r.geplaatst_op ? dagdeel(r.geplaatst_op) : null), [...DAGDELEN])} label={(g) => g} />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

// Leeg tonen als er niets is én de migratie wel bestaat (anders staat de melding er al).
function toonLeeg(leeg: boolean, melding: string | undefined): boolean {
  return leeg && !melding;
}

function Tegel({ label, waarde, plus }: { label: string; waarde: number | undefined | null; plus?: boolean }) {
  return (
    <div className="so-tegel">
      <dt>{label}</dt>
      <dd>{waarde == null ? '–' : `${plus && waarde > 0 ? '+' : ''}${formatGetal(waarde)}`}</dd>
    </div>
  );
}

const B = 600;
const H = 140;

function Lijn({ punten }: { punten: { label: string; waarde: number }[] }) {
  const { d, min, max, punten: xy } = lijnPad(
    punten.map((p) => p.waarde),
    B,
    H
  );
  const laatste = xy[xy.length - 1];
  return (
    <figure className="so-lijn">
      <svg viewBox={`0 0 ${B} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Volgers van ${formatGetal(punten[0].waarde)} naar ${formatGetal(punten[punten.length - 1].waarde)}`}>
        <line x1="0" x2={B} y1={H - 6} y2={H - 6} className="so-lijn-as" />
        <path d={`${d} L${B} ${H} L0 ${H} Z`} className="so-lijn-vlak" />
        <path d={d} className="so-lijn-pad" vectorEffect="non-scaling-stroke" />
        {laatste && <circle cx={laatste[0]} cy={laatste[1]} r="3.5" className="so-lijn-punt" />}
      </svg>
      <figcaption className="so-lijn-labels">
        <span>{dagMaand(punten[0].label)}</span>
        <span className="so-zacht">
          {formatGetal(min)} – {formatGetal(max)}
        </span>
        <span>{dagMaand(punten[punten.length - 1].label)}</span>
      </figcaption>
    </figure>
  );
}

function Staven({ groepen, label }: { groepen: GroepCijfer[]; label: (g: string) => string }) {
  const max = Math.max(1, ...groepen.map((g) => g.bereik));
  if (!groepen.some((g) => g.aantal)) return <p className="so-zacht">Nog geen geplaatste posts met cijfers.</p>;
  return (
    <ul className="so-staven">
      {groepen.map((g) => (
        <li key={g.groep}>
          <span className="so-staaf-label">{label(g.groep)}</span>
          <span className="so-staaf-baan" aria-hidden="true">
            <span className="so-staaf" style={{ width: `${(g.bereik / max) * 100}%` }} />
          </span>
          <span className="so-staaf-waarde">
            {g.aantal ? formatGetal(g.bereik) : '–'}
            <span className="so-zacht"> · {g.aantal} {g.aantal === 1 ? 'post' : 'posts'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
