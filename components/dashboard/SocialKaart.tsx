import Link from 'next/link';
import type { Teamlid } from '@/lib/auth/team';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { formatGepland } from '@/lib/social/kern';
import { SocialFout, dashboardSocial } from '@/lib/social/posts';
import { kortCaption } from '@/lib/social/weergave';
import { Kanaaliconen, PostThumb } from '@/components/social/PostKaart';
import { Kaart, KaartMelding } from './Kaart';
import { OpnieuwKnop } from './OpnieuwKnop';

// "Social": de eerstvolgende ingeplande posts en hoeveel concepten er klaarstaan (en of er
// deze week iets mislukte). Leest met de service-role ná de teamlidcontrole van de
// dashboardpagina (de social-tabellen hebben geen policies, migratie 0041).
export async function SocialKaart({ lid }: { lid: Teamlid }) {
  let data: Awaited<ReturnType<typeof dashboardSocial>>;
  try {
    data = await dashboardSocial(createServiceRoleClient(lid.bewijs), 3);
  } catch (e) {
    const migratie = e instanceof SocialFout && e.code === 'migratie';
    return (
      <Kaart label="Social" href="/social" className="db-social">
        <KaartMelding toon={migratie ? 'setup' : 'fout'} titel={migratie ? 'Social nog niet ingericht' : 'Social nu niet bereikbaar'} actie={<OpnieuwKnop />}>
          {migratie ? 'Voer in Supabase supabase/UITVOEREN_0041.sql uit.' : 'De posts konden niet worden opgehaald. Probeer het zo opnieuw.'}
        </KaartMelding>
      </Kaart>
    );
  }
  const nu = new Date();
  return (
    <Kaart label="Social" href="/social" className="db-social">
      {data.komend.length === 0 ? (
        <KaartMelding
          titel="Niets ingepland"
          actie={
            <Link className="db-knop" href="/social/nieuw">
              + Nieuwe post
            </Link>
          }
        >
          Plan een post in op dag en tijd; hij wordt dan vanzelf geplaatst.
        </KaartMelding>
      ) : (
        <ul className="so-dash">
          {data.komend.map((p) => (
            <li key={p.id}>
              <Link className="so-dash-rij" href={`/social/${p.id}`}>
                <PostThumb post={p} klein />
                <span className="so-dash-tekst">
                  <span className="so-dash-tijd">{p.gepland_op ? formatGepland(p.gepland_op, nu) : ''}</span>
                  <span className="so-dash-caption">{kortCaption(p.caption, 60) || 'Post zonder tekst'}</span>
                </span>
                <Kanaaliconen post={p} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="so-dash-voet">
        <Link className="db-kaart-link" href="/social?status=concept">
          {data.concepten} {data.concepten === 1 ? 'concept' : 'concepten'}
        </Link>
        {data.mislukt > 0 && (
          <Link className="db-kaart-link so-dash-mislukt" href="/social">
            {data.mislukt} mislukt
          </Link>
        )}
      </p>
    </Kaart>
  );
}
