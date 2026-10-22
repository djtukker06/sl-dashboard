import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Geen toegang · Studio Levant' };

// Hier komt een ingelogd account zonder (actief) teamlidmaatschap terecht. proxy.ts heeft
// de sessie dan al beëindigd. Bewust buiten app/(app): geen rail en geen enkele data.
export default function GeenToegangPage() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-banner" src="/brand/banner-licht.png" alt="Studio Levant" width={800} height={297} />
        <h1>Geen toegang</h1>
        <p className="section-hint" style={{ marginBottom: 12 }}>
          Dit account heeft (nog) geen toegang tot de Studio Levant-backoffice. Je bent daarom uitgelogd.
        </p>
        <p className="section-hint">
          Hoort dit wel zo te zijn? Vraag de eigenaar om je toe te voegen aan het team.
        </p>
        <Link href="/login" className="btn-primair" style={{ marginTop: 24 }}>
          Naar inloggen
        </Link>
      </div>
    </div>
  );
}
