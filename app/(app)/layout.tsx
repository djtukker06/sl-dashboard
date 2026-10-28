import Script from 'next/script';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { vereisTeamlidPagina } from '@/lib/auth/team';
import { teamProfielen } from '@/lib/team/profielen';
import { feedStatus, moetKoppelen } from '@/lib/agenda/feed';
import { logFout } from '@/lib/log';
import { Rail } from '@/components/shell/Rail';
import { TeamProvider } from '@/components/team/TeamProvider';
import '../../public/shell/shell.css';
import './app.css';
import './agenda.css';
import './mail.css';
import './uitgaven.css';
import './boekhouding.css';
import './account.css';
import './taken.css';
import './klanten.css';
import './bestanden.css';

// Gedeelde shell voor alle ingelogde React-pagina's (dashboard, mail, agenda, boekhouding, account).
// De social-module (statisch HTML) krijgt dezelfde rail via app/social/route.ts.
// Login, wachtwoordherstel en /geen-toegang staan buiten deze route-group en dus zonder rail.
//
// Toegang: sessie + actief teamlid (lib/auth/team.ts). Een layout rendert bij navigatie niet
// altijd opnieuw, dus elke pagina controleert daarnaast zelf (vereisTeamlidPagina).
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lid = await vereisTeamlidPagina();
  // Nieuw teamlid (bv. Bram bij zijn eerste login): eerst de welkomstflow. Alleen als
  // profiles.welkom_klaar_op bestaat en leeg is (migratie 0022); zie lib/auth/team.ts.
  if (!lid.welkomKlaar) redirect('/welkom');
  // Daarna verplicht: de agenda koppelen aan Apple/Google Agenda (migratie 0029).
  let koppelen = false;
  try {
    koppelen = !lid.overgang && moetKoppelen(await feedStatus(lid));
  } catch (e) {
    logFout('[shell] agenda-koppeling', e);
  }
  if (koppelen) redirect('/agenda-koppelen');
  const leden = await teamProfielen(lid);
  // Nonce van de Content-Security-Policy (proxy.ts) voor het losse shell-script.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <div className="sl-shell" data-gebruiker={lid.userId}>
      <Rail
        account={{ id: lid.userId, email: lid.email, naam: lid.profiel.naam, initialen: lid.profiel.initialen, kleur: lid.profiel.kleur, eigenaar: lid.rol === 'eigenaar' }}
      />
      <main className="sl-main">
        {lid.overgang && (
          <p className="sl-overgang" role="status">
            <strong>Teambeveiliging nog niet actief.</strong>
            <span>
              Voer in Supabase <code>supabase/UITVOEREN_0021_TEAM.sql</code> uit en zet daarna aanmelden uit (zie README).
            </span>
          </p>
        )}
        <TeamProvider mijnId={lid.userId} overgang={lid.overgang} boekhouding={lid.boekhouding} leden={leden}>
          {children}
        </TeamProvider>
      </main>
      <Script src="/shell/shell.js" strategy="afterInteractive" nonce={nonce} />
    </div>
  );
}
