import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { accountGegevens } from '@/lib/shell/rail';
import { dagLabel, groet, isoWeek } from '@/lib/dashboard/tijd';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Kaart, KaartMelding, KaartSkelet } from '@/components/dashboard/Kaart';
import { FacturenWidget } from '@/components/dashboard/FacturenWidget';
import { SocialWidget } from '@/components/dashboard/SocialWidget';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard · Studio Levant' };

// Dashboard "Vandaag": het startpunt van de backoffice. Elke widget is een eigen async
// server-component in <Suspense>, zodat één trage of kapotte bron de rest niet blokkeert.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  // Elke pagina controleert zelf de sessie (de widgets lezen daarna met de service-role).
  if (!user) redirect('/login');

  const nu = new Date();
  const { voornaam } = accountGegevens(user.email, user.user_metadata);

  return (
    <div className="db">
      <ModuleKop
        label={`${dagLabel(nu)} · week ${isoWeek(nu)}`}
        titel={`${groet(nu)}${voornaam ? `, ${voornaam}` : ''}`}
      >
        <Link className="db-knop db-knop-primair" href="/facturen/nieuwe-factuur">
          + Nieuwe factuur
        </Link>
        <Link className="db-knop" href="/facturen/prijsopgaven/nieuw">
          Nieuwe prijsopgave
        </Link>
        <a className="db-knop" href="/social#nieuw">
          Nieuwe post
        </a>
      </ModuleKop>

      <div className="db-grid">
        <Kaart label="Vandaag" href="/agenda" linkTekst="Agenda" className="db-breed">
          <KaartMelding titel="Agenda & taken komen hier">
            Je afspraken en taken van vandaag verschijnen op deze plek, met een tijdlijn van je dag.
          </KaartMelding>
        </Kaart>

        <Suspense fallback={<KaartSkelet label="Facturen" className="db-smal db-facturen" />}>
          <FacturenWidget />
        </Suspense>

        <Suspense fallback={<KaartSkelet label="Recente posts" regels={2} className="db-breed" />}>
          <SocialWidget />
        </Suspense>

        <Kaart label="Inbox" href="/mail" linkTekst="Mail" className="db-smal">
          <KaartMelding titel="Mail is nog niet gekoppeld">
            De inbox van info@studio-levant.nl verschijnt hier zodra de mailkoppeling is ingesteld.
          </KaartMelding>
        </Kaart>
      </div>
    </div>
  );
}
