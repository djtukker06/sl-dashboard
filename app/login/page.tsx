import { signIn } from '@/app/actions/login';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <span className="wordmark">
          Studio <span>Levant</span>
        </span>
        <h1>Inloggen</h1>
        {error && <div className="foutmelding">{error}</div>}
        <form action={signIn}>
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
      </div>
    </div>
  );
}
