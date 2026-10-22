import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/LogoutButton';
import { ModuleTegel } from '@/components/dashboard/ModuleTegel';
import { actieveModules } from '@/lib/modules';

// Overkoepelend dashboard van Studio Levant. Toont bewust geen factuurdata: alleen
// de modules uit het module-register (lib/modules.ts).
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const uur = Number(
    new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false })
      .format(new Date())
  );
  const groet = uur < 6 ? 'Goedenacht' : uur < 12 ? 'Goedemorgen' : uur < 18 ? 'Goedemiddag' : 'Goedenavond';
  const modules = actieveModules();

  return (
    <div className="wrap">
      <div className="topbar">
        <Link href="/" className="wordmark">
          Studio <span>Levant</span>
        </Link>
        <nav>
          <LogoutButton />
        </nav>
      </div>

      <div className="hero">
        <h1>Dashboard</h1>
        <p>
          {groet}
          {user?.email ? `, ${user.email}` : ''}. Kies hieronder een onderdeel van de
          backoffice van Studio Levant.
        </p>
      </div>

      <div className="dash-grid">
        {modules.map((m) => (
          <ModuleTegel key={m.id} module={m} />
        ))}
      </div>
    </div>
  );
}
