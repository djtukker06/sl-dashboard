import Link from 'next/link';
import { zetNieuwWachtwoord } from '@/app/actions/wachtwoord';

// Alleen bereikbaar met een sessie (proxy.ts): na de herstellink uit de mail, of
// ingelogd vanuit het dashboard.
export default async function NieuwWachtwoordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; gelukt?: string }>;
}) {
  const { error, gelukt } = await searchParams;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <span className="wordmark">
          Studio <span>Levant</span>
        </span>
        <h1>Nieuw wachtwoord</h1>
        {error && <div className="foutmelding">{error}</div>}
        {gelukt ? (
          <>
            <div className="geluktmelding">
              Je nieuwe wachtwoord is opgeslagen. Gebruik het voortaan om in te loggen.
            </div>
            <Link href="/" className="btn-primair">
              Naar het dashboard
            </Link>
          </>
        ) : (
          <form action={zetNieuwWachtwoord}>
            <label>
              Nieuw wachtwoord
              <input type="password" name="password" required minLength={8} autoFocus autoComplete="new-password" />
            </label>
            <label>
              Herhaal nieuw wachtwoord
              <input type="password" name="password2" required minLength={8} autoComplete="new-password" />
            </label>
            <button type="submit" className="btn-primair">
              Wachtwoord opslaan
            </button>
          </form>
        )}
        {!gelukt && (
          <Link href="/" className="login-link">
            Annuleren
          </Link>
        )}
      </div>
    </div>
  );
}
