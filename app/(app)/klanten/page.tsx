import type { Metadata } from 'next';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { bronVan } from '@/lib/agenda/api';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { isNietIngericht, klantenLijst } from '@/lib/crm/repo';
import { CrmKop, CrmNietIngericht } from '@/components/crm/CrmKop';
import { CrmProviders } from '@/components/crm/CrmProviders';
import { KlantenLijst, NieuweKlantKnop } from '@/components/crm/KlantenLijst';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Klanten · Studio Levant' };

// Klanten (gedeeld met het team) in vier tabs: Op de radar (koude leads, 0033), Leads
// (opvolgen), Actief en Afgerond. Zoeken, sorteren en snel toevoegen (één veld + Enter).
// Dezelfde klanten als in de facturen.
//   ?tab=radar|leads|actief|afgerond   kiest de tab (bv. vanaf de dashboardkaart "Opvolgen")
//   ?nieuw=1                     zet de cursor meteen in "Nieuwe klant"
export default async function KlantenPage({ searchParams }: { searchParams: Promise<{ nieuw?: string; tab?: string }> }) {
  const lid = await vereisTeamlidPagina('/klanten');
  if (lid.overgang) return <CrmNietIngericht actief="klanten" />;

  const sp = await searchParams;
  let data;
  try {
    data = await klantenLijst(bronVan(lid));
  } catch (e) {
    if (isNietIngericht(e)) return <CrmNietIngericht actief="klanten" />;
    throw e;
  }
  const tab =
    sp.tab === 'leads' || sp.tab === 'lead'
      ? 'lead'
      : sp.tab === 'radar' || sp.tab === 'koud'
        ? 'koud'
        : sp.tab === 'actief' || sp.tab === 'afgerond'
          ? sp.tab
          : undefined;

  return (
    <CrmProviders taakSneltoets={false}>
      <CrmKop actief="klanten">
        <NieuweKlantKnop />
      </CrmKop>
      <div className="kp">
        <KlantenLijst
          klanten={data.klanten}
          opvolging={data.opvolging}
          vandaag={vandaagNL()}
          nu={new Date().toISOString()}
          startTab={tab}
          startNieuw={sp.nieuw === '1'}
        />
      </div>
    </CrmProviders>
  );
}
