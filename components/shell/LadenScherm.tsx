'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { dagLabel, groet, isoWeek } from '@/lib/dashboard/tijd';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { BoekhoudingKop } from '@/components/boekhouding/BoekhoudingKop';
import { FacturenKop } from '@/components/boekhouding/FacturenKop';
import { BankSubnav } from '@/components/boekhouding/BankSubnav';
import { CrmKop } from '@/components/crm/CrmKop';
import { Icoon } from '@/components/mail/Iconen';
import { UgIcoon } from '@/components/uitgaven/Iconen';
import { useTeam } from '@/components/team/TeamProvider';

// Laadscherm bij het wisselen van pagina (de loading.tsx-bestanden in app/(app)). Per pad
// staat hier precies dezelfde kop als op de echte pagina — label, titel, subnavigatie en de
// knoppen rechts — op dezelfde plek en met dezelfde container eronder (zelfde klasse, dus
// dezelfde marges en verticale ruimte; de breedte is op elke pagina gelijk, zie app.css
// "Inhoudsbreedte"). Alleen de inhoud is een skelet.
// Wat pas met de gegevens bekend is (bv. de naam van een klant) is een grijs balkje in
// hetzelfde formaat. De knoppen zijn hier stille kopieën: ze werken pas als de pagina er is.
//
// Houd dit in de pas met de koppen van de pagina's zelf (ModuleKop, BoekhoudingKop, CrmKop).
export function LadenScherm({ dashboard }: { dashboard?: React.ReactNode }) {
  const pad = (usePathname() || '/').replace(/\/+$/, '') || '/';
  const delen = pad.split('/').filter(Boolean);
  const [eerste, tweede, derde, vierde] = delen;

  if (pad === '/') return <DashboardLaden grid={dashboard} />;

  switch (eerste) {
    case 'mail':
      return (
        <div className="ml-app">
          <ModuleKop label={<LabelSkelet />} titel="Mail">
            <KnopPlek>
              <Icoon naam="ververs" grootte={15} className="ml-icoon" />
              <span className="ml-verberg-mobiel">Verversen</span>
            </KnopPlek>
            <KnopPlek primair>
              <Icoon naam="plus" grootte={15} />
              Nieuwe mail
            </KnopPlek>
          </ModuleKop>
          <InhoudSkelet />
        </div>
      );
    case 'agenda':
      return <AgendaLaden />;
    case 'klanten':
      return tweede ? (
        <>
          <ModuleKop label={<Link href="/klanten">← Klanten</Link>} titel={<TitelSkelet />} />
          <InhoudSkelet klasse="kp kp-detail" />
        </>
      ) : (
        <>
          <CrmKop actief="klanten">
            <KnopPlek primair>+ Klant</KnopPlek>
          </CrmKop>
          <InhoudSkelet klasse="kp" />
        </>
      );
    case 'projecten':
      return tweede ? (
        <>
          <ModuleKop label={<Link href="/projecten">← Projecten</Link>} titel={<TitelSkelet />} />
          <InhoudSkelet klasse="kp kp-detail" />
        </>
      ) : (
        <>
          <CrmKop actief="projecten">
            <KnopPlek primair>+ Project</KnopPlek>
          </CrmKop>
          <InhoudSkelet klasse="kp kp-breed" />
        </>
      );
    case 'scratchpad':
      return (
        <>
          <ModuleKop label="Brainstormen · ideeën · losse gedachten" titel="Scratchpad">
            <KnopPlek primair>+ Nieuwe notitie</KnopPlek>
          </ModuleKop>
          <InhoudSkelet klasse="sl-laden-inhoud sp-laadscherm" />
        </>
      );
    case 'bestanden':
      return (
        <>
          <ModuleKop label="Studio Levant · Google Drive" titel="Bestanden" />
          <InhoudSkelet klasse="bs" />
        </>
      );
    case 'account':
      return <AccountLaden titel="Account & mail" />;
    case 'beveiliging':
      return <AccountLaden titel="Beveiliging & audit" />;
    case 'gebruikers':
      return <AccountLaden titel="Gebruikers" />;
    case 'facturen':
      // Zelfde kop als app/(app)/facturen/layout.tsx; de inhoud staat in .wrap (globals.css).
      return (
        <>
          <FacturenKop />
          <FacturenSkelet />
        </>
      );
    case 'boekhouding':
      return <BoekhoudingLaden tweede={tweede} derde={derde} vierde={vierde} />;
    default:
      return (
        <>
          <ModuleKop label={<LabelSkelet />} titel={<TitelSkelet />} />
          <InhoudSkelet />
        </>
      );
  }
}

/** De inhoud van een facturenscherm (de kop staat al in facturen/layout.tsx). */
export function FacturenSkelet() {
  return <InhoudSkelet klasse="wrap" />;
}

function DashboardLaden({ grid }: { grid?: React.ReactNode }) {
  const { mijnId, perId } = useTeam();
  const voornaam = perId.get(mijnId)?.voornaam ?? '';
  // Eén keer vastgelegd (niet bij elke render een nieuwe klok); zelfde tekst als app/(app)/page.tsx.
  const [nu] = useState(() => new Date());
  return (
    <div className="db">
      <ModuleKop
        label={<span suppressHydrationWarning>{`${dagLabel(nu)} · week ${isoWeek(nu)}`}</span>}
        titel={<span suppressHydrationWarning>{`${groet(nu)}${voornaam ? `, ${voornaam}` : ''}`}</span>}
      >
        <KnopPlek primair>+ Taak</KnopPlek>
        <Link className="db-knop" href="/facturen/nieuwe-factuur">
          Nieuwe factuur
        </Link>
        <Link className="db-knop" href="/facturen/prijsopgaven/nieuw">
          Nieuwe prijsopgave
        </Link>
        <BonnetjePlek />
        <a className="db-knop" href="/social#nieuw">
          Nieuwe post
        </a>
      </ModuleKop>
      {grid ?? <InhoudSkelet klasse="db-grid" />}
    </div>
  );
}

function AgendaLaden() {
  const [nu] = useState(() => new Date());
  return (
    <>
      <ModuleKop label={<span suppressHydrationWarning>{`Planning · week ${isoWeek(nu)}`}</span>} titel="Agenda & taken">
        <KnopPlek primair>+ Taak</KnopPlek>
        <KnopPlek>+ Afspraak</KnopPlek>
        <div className="ag-mobiel-tabs sl-laden-knop" aria-hidden="true">
          <button type="button" role="tab" tabIndex={-1} aria-selected={false}>
            Taken
          </button>
          <button type="button" role="tab" tabIndex={-1} aria-selected>
            Agenda
          </button>
        </div>
      </ModuleKop>
      <InhoudSkelet />
    </>
  );
}

function AccountLaden({ titel }: { titel: string }) {
  return (
    <div className="ac">
      <ModuleKop label="Account" titel={titel} />
      <InhoudSkelet klasse="ac-inhoud" />
    </div>
  );
}

const BOEKHOUD_TITELS: Record<string, string> = {
  bank: 'Bank & boekingen',
  openstaand: 'Openstaand & afletteren',
  btw: 'Btw-aangifte',
  activa: 'Activa & afschrijvingen',
  rapporten: 'Rapporten & jaarrekening',
  instellingen: 'Instellingen'
};

function BoekhoudingLaden({ tweede, derde, vierde }: { tweede?: string; derde?: string; vierde?: string }) {
  const { boekhouding } = useTeam();

  if (!tweede) {
    return (
      <div className="bh">
        <BoekhoudingKop titel="Boekhouding" />
        <div className="bh-tegels" aria-busy="true" aria-label="Laden…">
          {[0, 1].map((i) => (
            <section key={i} className="bh-tegel">
              <SkeletRegels />
            </section>
          ))}
        </div>
      </div>
    );
  }

  if (tweede === 'bonnetjes') {
    return (
      <div className="ug">
        <BoekhoudingKop titel="Bonnetjes & inkoopfacturen">
          {boekhouding && (
            <div className="ug-meer">
              <KnopPlek>
                Meer <span aria-hidden="true">▾</span>
              </KnopPlek>
            </div>
          )}
        </BoekhoudingKop>
        <InhoudSkelet klasse="ug-inhoud" />
      </div>
    );
  }

  let titel = BOEKHOUD_TITELS[tweede] ?? 'Boekhouding';
  let subnav: React.ReactNode = null;
  let klasse = 'bh-inhoud';
  if (tweede === 'bank') {
    const importeren = derde === 'importeren';
    if (importeren) titel = 'Afschrift importeren';
    subnav = <BankSubnav actief={importeren ? 'importeren' : 'boekingen'} />;
    if (importeren) klasse = 'bh-inhoud bh-import';
  } else if (tweede === 'openstaand') {
    subnav = <BankSubnav actief="openstaand" />;
  } else if (tweede === 'btw' && derde && /^\d{4}$/.test(derde) && /^[1-4]$/.test(vierde ?? '')) {
    titel = `Btw-aangifte Q${vierde} ${derde}`;
  } else if (tweede === 'rapporten' && derde === 'jaarafsluiting' && vierde && /^\d{4}$/.test(vierde)) {
    titel = `Jaarafsluiting ${vierde}`;
  } else if (tweede === 'instellingen') {
    klasse = 'bh-inhoud bh-instellingen';
  }

  return (
    <div className="bh">
      <BoekhoudingKop titel={titel} />
      {subnav}
      <InhoudSkelet klasse={klasse} />
    </div>
  );
}

/** "+ Bonnetje" zoals BonnetjeKnop het toont (met de cameraknop op een aanraakscherm). */
function BonnetjePlek() {
  return (
    <>
      <KnopPlek>+ Bonnetje</KnopPlek>
      <span className="db-knop ug-alleen-mobiel ug-camera-knop sl-laden-knop" aria-hidden="true">
        <UgIcoon naam="camera" grootte={18} />
        <span className="ug-camera-label">Foto</span>
      </span>
    </>
  );
}

/** Stille kopie van een knop in de kop: zelfde vorm en maat, nog niet klikbaar. */
function KnopPlek({ primair = false, children }: { primair?: boolean; children: React.ReactNode }) {
  return (
    <span className={`db-knop${primair ? ' db-knop-primair' : ''} sl-laden-knop`} aria-hidden="true">
      {children}
    </span>
  );
}

function LabelSkelet() {
  return <span className="db-skelet sl-laden-label" />;
}

function TitelSkelet() {
  return <span className="db-skelet sl-laden-titel" />;
}

function SkeletRegels() {
  return (
    <div className="sl-laden-blok">
      <div className="db-skelet db-skelet-groot" />
      {[92, 78, 85, 64, 88, 70].map((b, i) => (
        <div key={i} className="db-skelet" style={{ width: `${b}%` }} />
      ))}
    </div>
  );
}

/** Skelet van de inhoud, in de container van de echte pagina (zelfde breedte en marges). */
function InhoudSkelet({ klasse = 'sl-laden-inhoud' }: { klasse?: string }) {
  return (
    <div className={klasse} aria-busy="true" aria-label="Laden…">
      <SkeletRegels />
    </div>
  );
}
