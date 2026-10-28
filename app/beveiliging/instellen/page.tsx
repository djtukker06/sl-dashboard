import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { huidigTeamlid } from '@/lib/auth/team';
import { veiligVervolg } from '@/lib/vervolg';
import { TfaVerplicht } from '@/components/beveiliging/TfaVerplicht';
import '../../../public/shell/shell.css';
import '../../(app)/app.css';
import '../../(app)/agenda.css';
import '../../(app)/account.css';
import '../../welkom/welkom.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Tweestapsverificatie instellen · Studio Levant' };

// Verplicht 2FA instellen voor een bestaand teamlid (bv. Daniel na de uitrol). Zonder rail:
// tot de eerste code is bevestigd, opent verder niets. Een nieuw teamlid doet dit in de
// welkomstflow (/welkom).
export default async function TfaInstellenPagina({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const vervolg = veiligVervolg(next);
  const s = await huidigTeamlid();
  if (s.soort === 'anoniem') redirect('/login?next=/beveiliging/instellen');
  if (s.soort === 'geen_toegang') redirect('/geen-toegang');
  if (s.soort === 'storing') throw new Error('De toegangscontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.');
  if (s.soort === 'wachtwoord') redirect('/nieuw-wachtwoord');
  if (s.soort === 'tfa' && s.stap === 'uitdaging') redirect(`/login/2fa?next=${encodeURIComponent('/beveiliging/instellen')}`);
  // Al ingesteld (of niet verplicht): extra apparaten beheer je op /account.
  if (s.soort === 'lid') redirect(s.lid.tfa.factoren.length ? vervolg : '/account#beveiliging');
  if (!s.sessie.welkomKlaar) redirect('/welkom');

  return <TfaVerplicht voornaam={s.sessie.profiel.voornaam} vervolg={vervolg} />;
}
