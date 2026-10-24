import Link from 'next/link';
import { zetNieuwWachtwoord } from '@/app/actions/wachtwoord';
import { huidigTeamlid } from '@/lib/auth/team';

// Alleen bereikbaar met een sessie (proxy.ts): na de herstellink uit de mail, of
// ingelogd vanuit het dashboard. Een nieuw teamlid (welkomstflow nog niet doorlopen, komt
// hier via de uitnodigingsmail) krijgt een welkomsttekst, geen "Annuleren" (zonder
// wachtwoord kan hij later niet inloggen) en gaat daarna door naar /welkom.
export default async function NieuwWachtwoordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; gelukt?: string }>;
}) {
  const { error, gelukt } = await searchParams;
  const status = await huidigTeamlid();
  const nieuw =
    (status.soort === 'lid' && !status.lid.welkomKlaar) || (status.soort === 'tfa' && !status.sessie.welkomKlaar);

  return (
    <div className="login-wrap">
      <div className="login-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-banner" src="/brand/banner-licht.png" alt="Studio Levant" width={800} height={297} />
        <h1>{nieuw ? 'Welkom bij Studio Levant' : 'Nieuw wachtwoord'}</h1>
        {nieuw && !gelukt && (
          <p className="section-hint" style={{ marginBottom: 20 }}>
            Kies een wachtwoord om voortaan mee in te loggen.
          </p>
        )}
        {error && <div className="foutmelding">{error}</div>}
        {gelukt ? (
          <>
            <div className="geluktmelding">
              Je nieuwe wachtwoord is opgeslagen. Gebruik het voortaan om in te loggen.
            </div>
            <Link href={nieuw ? '/welkom' : '/'} className="btn-primair">
              {nieuw ? 'Verder' : 'Naar het dashboard'}
            </Link>
          </>
        ) : (
          <form action={zetNieuwWachtwoord}>
            <p className="section-hint">Minstens 12 tekens. Een zin van een paar woorden werkt goed en is makkelijk te onthouden.</p>
            <label>
              Nieuw wachtwoord
              <input type="password" name="password" required minLength={12} autoFocus autoComplete="new-password" />
            </label>
            <label>
              Herhaal nieuw wachtwoord
              <input type="password" name="password2" required minLength={12} autoComplete="new-password" />
            </label>
            <button type="submit" className="btn-primair">
              Wachtwoord opslaan
            </button>
          </form>
        )}
        {!gelukt && !nieuw && (
          <Link href="/" className="login-link">
            Annuleren
          </Link>
        )}
      </div>
    </div>
  );
}
