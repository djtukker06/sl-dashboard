import Script from 'next/script';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Rail } from '@/components/shell/Rail';
import '../../public/shell/shell.css';
import './app.css';
import './agenda.css';
import './mail.css';
import './uitgaven.css';

// Gedeelde shell voor alle ingelogde React-pagina's (dashboard, mail, agenda, uitgaven, facturen).
// De social-module (statisch HTML) krijgt dezelfde rail via app/social/route.ts.
// Login en wachtwoordherstel staan buiten deze route-group en dus zonder rail.
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  // De proxy stuurt niet-ingelogde bezoekers al door; dit is de tweede linie.
  if (!user) redirect('/login');

  return (
    <div className="sl-shell">
      <Rail email={user.email ?? ''} metadata={user.user_metadata} />
      <main className="sl-main">{children}</main>
      <Script src="/shell/shell.js" strategy="afterInteractive" />
    </div>
  );
}
