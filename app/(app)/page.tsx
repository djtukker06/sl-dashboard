import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { dagLabel, groet, isoWeek } from '@/lib/dashboard/tijd';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { KaartSkelet } from '@/components/dashboard/Kaart';
import { InboxKaart, InboxKaartSkelet, NieuweMailKnop } from '@/components/dashboard/InboxKaart';
import { FacturenWidget } from '@/components/dashboard/FacturenWidget';
import { PlanningSkelet, PlanningWidgets } from '@/components/dashboard/PlanningWidgets';
import { OpvolgenWidget } from '@/components/dashboard/OpvolgenWidget';
import { ProjectenWidget } from '@/components/dashboard/ProjectenWidget';
import { TaakKnop } from '@/components/dashboard/TaakKnop';
import { UitgavenWidget } from '@/components/dashboard/UitgavenWidget';
import { BonnetjeKnop } from '@/components/uitgaven/BonnetjeKnop';
import { DashboardTaken } from '@/components/taken/DashboardTaken';
import { BackupWaarschuwing } from '@/components/dashboard/BackupWaarschuwing';
import { ScratchpadWidget } from '@/components/dashboard/ScratchpadWidget';
import { SocialKaart } from '@/components/dashboard/SocialKaart';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard · Studio Levant' };

// Dashboard "Vandaag": het eigen startpunt van elk teamlid. Elke widget is een eigen async
// server-component in <Suspense>, zodat één trage of kapotte bron de rest niet blokkeert.
//   - persoonlijk: begroeting, jouw afspraken en taken, wat je uitdeelde, jouw mailbox;
//   - gedeeld met het team: op te volgen leads/klanten (alleen als er iets is), projecten
//     (tellers per status), de eerstvolgende social-posts, facturen, bonnetjes en de
//     Scratchpad (vastgepinde en laatst bewerkte notities).
export default async function DashboardPage() {
  // Elke pagina controleert zelf sessie + teamlidmaatschap.
  const lid = await vereisTeamlidPagina('/');

  const nu = new Date();
  const voornaam = lid.profiel.voornaam;

  return (
    <DashboardTaken>
      <div className="db">
        <ModuleKop
          label={`${dagLabel(nu)} · week ${isoWeek(nu)}`}
          titel={`${groet(nu)}${voornaam ? `, ${voornaam}` : ''}`}
        >
          <TaakKnop />
          <Link className="db-knop" href="/facturen/nieuwe-factuur">
            Nieuwe factuur
          </Link>
          <Link className="db-knop" href="/facturen/prijsopgaven/nieuw">
            Nieuwe prijsopgave
          </Link>
          <BonnetjeKnop />
          {/* Alleen je eigen mailbox; de mailcheck houdt de rest van de pagina niet op. */}
          <Suspense fallback={null}>
            <NieuweMailKnop lid={lid} />
          </Suspense>
        </ModuleKop>

        {/* Alleen de eigenaar: back-up mislukt/te oud of keep-alive stil. */}
        <Suspense fallback={null}>
          <BackupWaarschuwing lid={lid} />
        </Suspense>

        <div className="db-grid">
          {/* Jouw Vandaag, Deze week en Taken (alleen op jouw naam; uitgezet = alleen een link). */}
          <Suspense fallback={<PlanningSkelet />}>
            <PlanningWidgets lid={lid} />
          </Suspense>

          {/* Inbox: de mailcheck in Suspense, IMAP daarna in de client (InboxWidget). */}
          <Suspense fallback={<InboxKaartSkelet />}>
            <InboxKaart lid={lid} />
          </Suspense>

          {/* Scratchpad: vastgepinde en laatst bewerkte notities (notities.css), links naast de stapel. */}
          <Suspense fallback={<KaartSkelet label="Scratchpad" regels={3} className="db-scratchpad" />}>
            <ScratchpadWidget lid={lid} />
          </Suspense>

          {/* Projecten (tellers per status), facturen en de laatste bonnetjes onder elkaar naast de Scratchpad. */}
          <div className="db-smal db-stapel">
            {/* Opvolgen: alleen zichtbaar als er vandaag (of eerder) iets op te volgen is. */}
            <Suspense fallback={null}>
              <OpvolgenWidget lid={lid} />
            </Suspense>
            <Suspense fallback={<KaartSkelet label="Projecten" regels={1} className="db-projecten" />}>
              <ProjectenWidget lid={lid} />
            </Suspense>
            {/* Social: eerstvolgende ingeplande posts + aantal concepten (migratie 0041). */}
            <Suspense fallback={<KaartSkelet label="Social" regels={2} className="db-social" />}>
              <SocialKaart lid={lid} />
            </Suspense>
            <Suspense fallback={<KaartSkelet label="Facturen" className="db-facturen" />}>
              <FacturenWidget lid={lid} />
            </Suspense>
            <Suspense fallback={<KaartSkelet label="Laatste bonnetjes" className="db-uitgaven" />}>
              <UitgavenWidget />
            </Suspense>
          </div>
        </div>
      </div>
    </DashboardTaken>
  );
}
