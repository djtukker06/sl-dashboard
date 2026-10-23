import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { dagLabel, groet, isoWeek } from '@/lib/dashboard/tijd';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { KaartSkelet } from '@/components/dashboard/Kaart';
import { InboxKaart, InboxKaartSkelet, NieuweMailKnop } from '@/components/dashboard/InboxKaart';
import { FacturenWidget } from '@/components/dashboard/FacturenWidget';
import { SocialWidget } from '@/components/dashboard/SocialWidget';
import { PlanningSkelet, PlanningWidgets } from '@/components/dashboard/PlanningWidgets';
import { ProjectenWidget } from '@/components/dashboard/ProjectenWidget';
import { TaakKnop } from '@/components/dashboard/TaakKnop';
import { UitgavenWidget } from '@/components/dashboard/UitgavenWidget';
import { BonnetjeKnop } from '@/components/uitgaven/BonnetjeKnop';
import { DashboardTaken } from '@/components/taken/DashboardTaken';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard · Studio Levant' };

// Dashboard "Vandaag": het eigen startpunt van elk teamlid. Elke widget is een eigen async
// server-component in <Suspense>, zodat één trage of kapotte bron de rest niet blokkeert.
//   - persoonlijk: begroeting, jouw afspraken en taken, wat je uitdeelde, jouw mailbox;
//   - gedeeld met het team: projecten (tellers per status), facturen, bonnetjes en posts
//     (met wie ze maakte).
export default async function DashboardPage() {
  // Elke pagina controleert zelf sessie + teamlidmaatschap (de social-widget leest daarna
  // met de service-role, met dit teamlid als bewijs).
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
          <a className="db-knop" href="/social#nieuw">
            Nieuwe post
          </a>
          {/* Alleen je eigen mailbox; de mailcheck houdt de rest van de pagina niet op. */}
          <Suspense fallback={null}>
            <NieuweMailKnop lid={lid} />
          </Suspense>
        </ModuleKop>

        <div className="db-grid">
          {/* Jouw Vandaag, Deze week en Taken (alleen op jouw naam; uitgezet = alleen een link). */}
          <Suspense fallback={<PlanningSkelet />}>
            <PlanningWidgets lid={lid} />
          </Suspense>

          {/* Inbox: de mailcheck in Suspense, IMAP daarna in de client (InboxWidget). */}
          <Suspense fallback={<InboxKaartSkelet />}>
            <InboxKaart lid={lid} />
          </Suspense>

          <Suspense fallback={<KaartSkelet label="Recente posts" regels={2} className="db-breed" />}>
            <SocialWidget lid={lid} />
          </Suspense>

          {/* Projecten (tellers per status), facturen en de laatste bonnetjes onder elkaar naast de posts. */}
          <div className="db-smal db-stapel">
            <Suspense fallback={<KaartSkelet label="Projecten" regels={1} className="db-projecten" />}>
              <ProjectenWidget lid={lid} />
            </Suspense>
            <Suspense fallback={<KaartSkelet label="Facturen" className="db-facturen" />}>
              <FacturenWidget />
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
