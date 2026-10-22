import { recentePosts } from '@/lib/dashboard/social';
import { relatief } from '@/lib/dashboard/tijd';
import { Kaart, KaartMelding } from './Kaart';
import { OpnieuwKnop } from './OpnieuwKnop';

const THUMB_H = 168;
const THUMB_MAX_W = 150;

// Laatste posts uit de social-module, met de eerste slide als miniatuur (zelfde
// sandbox als de thumbnails in social zelf: geen scripts). Een klik opent het project
// via de bestaande deep-link /social#p=<id>.
export async function SocialWidget() {
  const res = await recentePosts(4);

  if (!res.ok) {
    return (
      <Kaart label="Recente posts" href="/social" document className="db-breed db-social">
        <KaartMelding
          toon={res.reden === 'fout' ? 'fout' : 'setup'}
          titel={res.reden === 'fout' ? 'Posts nu niet bereikbaar' : 'Social nog niet ingericht'}
          actie={<OpnieuwKnop />}
        >
          {res.reden === 'fout'
            ? 'De posts konden niet worden opgehaald. Probeer het zo opnieuw.'
            : 'Voer in Supabase de migraties 0014–0017 uit en importeer daarna de bestaande posts.'}
        </KaartMelding>
      </Kaart>
    );
  }

  if (res.posts.length === 0) {
    return (
      <Kaart label="Recente posts" href="/social" document className="db-breed db-social">
        <KaartMelding
          titel="Nog geen posts"
          actie={
            <a className="db-knop db-knop-primair" href="/social#nieuw">
              + Nieuwe post
            </a>
          }
        >
          Maak een post en Claude ontwerpt de slides in de huisstijl.
        </KaartMelding>
      </Kaart>
    );
  }

  return (
    <Kaart
      label="Recente posts"
      href="/social"
      document
      linkTekst={res.totaal > res.posts.length ? `Alle ${res.totaal}` : 'Alles'}
      className="db-breed db-social"
    >
      <ul className="db-posts">
        {res.posts.map((p) => {
          const schaal = Math.min(THUMB_H / p.hoogte, THUMB_MAX_W / p.breedte);
          const src = p.eersteSlide
            ? `/social-files/projects/${encodeURIComponent(p.id)}/slides/${encodeURIComponent(p.eersteSlide)}?v=${encodeURIComponent(p.gewijzigd)}`
            : null;
          return (
            <li key={p.id}>
              <a className="db-post" href={`/social#p=${encodeURIComponent(p.id)}`}>
                <span className="db-post-thumb" style={{ height: THUMB_H }}>
                  {src ? (
                    <span
                      className="db-post-frame"
                      style={{ width: Math.round(p.breedte * schaal), height: Math.round(p.hoogte * schaal) }}
                    >
                      <iframe
                        src={src}
                        title=""
                        aria-hidden="true"
                        tabIndex={-1}
                        loading="lazy"
                        sandbox="allow-same-origin"
                        width={p.breedte}
                        height={p.hoogte}
                        style={{ width: p.breedte, height: p.hoogte, transform: `scale(${schaal})` }}
                      />
                    </span>
                  ) : (
                    <span className="db-post-leeg">Nog geen slides</span>
                  )}
                </span>
                <span className="db-post-naam">{p.naam}</span>
                <span className="db-rij-meta">
                  {p.aantalSlides} {p.aantalSlides === 1 ? 'slide' : 'slides'} · {relatief(p.gewijzigd)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </Kaart>
  );
}
