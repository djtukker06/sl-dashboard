import Link from 'next/link';
import { vraagHerstelAan } from '@/app/actions/wachtwoord';

export default async function WachtwoordVergetenPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; verstuurd?: string }>;
}) {
  const { error, verstuurd } = await searchParams;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <span className="wordmark">
          Studio <span>Levant</span>
        </span>
        <h1>Wachtwoord vergeten</h1>
        {error && <div className="foutmelding">{error}</div>}
        {verstuurd ? (
          <div className="geluktmelding">
            Als dit e-mailadres een account heeft, staat er nu een mail met een herstellink in je
            inbox. Open de link in deze browser om een nieuw wachtwoord te kiezen.
          </div>
        ) : (
          <form action={vraagHerstelAan}>
            <p className="section-hint">
              Vul je e-mailadres in. Je krijgt een mail met een link om een nieuw wachtwoord te
              kiezen.
            </p>
            <label>
              E-mailadres
              <input type="email" name="email" required autoFocus />
            </label>
            <button type="submit" className="btn-primair">
              Stuur herstelmail
            </button>
          </form>
        )}
        <Link href="/login" className="login-link">
          Terug naar inloggen
        </Link>
      </div>
    </div>
  );
}
