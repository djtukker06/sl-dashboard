import Link from 'next/link';
import { signIn } from '@/app/actions/login';
import { VervolgVeld } from '@/components/VervolgVeld';
import { veiligVervolg } from '@/lib/vervolg';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const vervolg = veiligVervolg(next);

  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-banner" src="/brand/banner-licht.png" alt="Studio Levant" width={800} height={297} />
        <h1>Inloggen</h1>
        {error && <div className="foutmelding">{error}</div>}
        <form action={signIn}>
          <VervolgVeld next={vervolg !== '/' ? vervolg : undefined} />
          <label>
            E-mailadres
            <input type="email" name="email" required autoFocus />
          </label>
          <label>
            Wachtwoord
            <input type="password" name="password" required />
          </label>
          <button type="submit" className="btn-primair">
            Inloggen
          </button>
        </form>
        <Link href="/wachtwoord-vergeten" className="login-link">
          Wachtwoord vergeten?
        </Link>
      </div>
    </div>
  );
}
