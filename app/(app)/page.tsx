import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { dagLabel, groet, isoWeek } from '@/lib/dashboard/tijd';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Kaart, KaartSkelet } from '@/components/dashboard/Kaart';
import { InboxWidget } from '@/components/dashboard/InboxWidget';
import { NietGekoppeld } from '@/components/mail/NietGekoppeld';
import { magEnvMailbox, mailConfigVoor } from '@/lib/mail/config';
import { FacturenWidget } from '@/components/dashboard/FacturenWidget';
import { SocialWidget } from '@/components/dashboard/SocialWidget';
import { PlanningSkelet, PlanningWidgets } from '@/components/dashboard/PlanningWidgets';
import { TaakKnop } from '@/components/dashboard/TaakKnop';
import { UitgavenWidget } from '@/components/dashboard/UitgavenWidget';
import { BonnetjeKnop } from '@/components/uitgaven/BonnetjeKnop';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard · Studio Levant' };

// Dashboard "Vandaag": het startpunt van de backoffice. Elke widget is een eigen async
// server-component in <Suspense>, zodat één trage of kapotte bron de rest niet blokkeert.
export default async function DashboardPage() {
  // Elke pagina controleert zelf sessie + teamlidmaatschap (de social-widget leest daarna
  // met de service-role, met dit teamlid als bewijs).
  const lid = await vereisTeamlidPagina('/');

  const nu = new Date();
  const voornaam = lid.profiel.voornaam;
  // Alleen je eigen mailbox (nooit die van een ander teamlid).
  const mailGekoppeld = (await mailConfigVoor(lid)) !== null;

  return (
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
        {mailGekoppeld && (
          <Link className="db-knop" href="/mail?nieuw=1">
            Nieuwe mail
          </Link>
        )}
      </ModuleKop>

      <div className="db-grid">
        {/* Snelinvoer (volle breedte), Vandaag, Deze week en Taken. */}
        <Suspense fallback={<PlanningSkelet />}>
          <PlanningWidgets />
        </Suspense>

        {/* Inbox: client-component, zodat IMAP de eerste weergave niet ophoudt. */}
        {mailGekoppeld ? (
          <InboxWidget />
        ) : (
          <Kaart label="Inbox" href="/mail" linkTekst="Mail" className="db-smal db-inbox">
            <NietGekoppeld compact reden={magEnvMailbox(lid) ? 'instellen' : 'eigen'} />
          </Kaart>
        )}

        <Suspense fallback={<KaartSkelet label="Recente posts" regels={2} className="db-breed" />}>
          <SocialWidget lid={lid} />
        </Suspense>

        {/* Facturen en uitgaven onder elkaar naast de posts. */}
        <div className="db-smal db-stapel">
          <Suspense fallback={<KaartSkelet label="Facturen" className="db-facturen" />}>
            <FacturenWidget />
          </Suspense>
          <Suspense fallback={<KaartSkelet label="Uitgaven" className="db-uitgaven" />}>
            <UitgavenWidget />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
