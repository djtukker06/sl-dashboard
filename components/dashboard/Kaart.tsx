import Link from 'next/link';

// Kaart op het dashboard: mono-label + optionele "Alles →"-link, daaronder de inhoud.
export function Kaart({
  label,
  href,
  linkTekst = 'Alles',
  document = false,
  className = '',
  children
}: {
  label: string;
  href?: string;
  linkTekst?: string;
  /** true = gewone <a> (volledige paginalading, voor social). */
  document?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const link = href ? (
    document ? (
      <a className="db-kaart-link" href={href}>
        {linkTekst} <span aria-hidden="true">→</span>
      </a>
    ) : (
      <Link className="db-kaart-link" href={href}>
        {linkTekst} <span aria-hidden="true">→</span>
      </Link>
    )
  ) : null;
  return (
    <section className={`db-kaart ${className}`} aria-label={label}>
      <header className="db-kaart-kop">
        <h2 className="db-label">{label}</h2>
        {link}
      </header>
      <div className="db-kaart-inhoud">{children}</div>
    </section>
  );
}

/** Rustige lege staat of melding binnen een kaart. */
export function KaartMelding({
  titel,
  children,
  actie,
  toon = 'leeg'
}: {
  titel: string;
  children?: React.ReactNode;
  actie?: React.ReactNode;
  toon?: 'leeg' | 'fout' | 'setup';
}) {
  return (
    <div className={`db-melding db-melding-${toon}`} role={toon === 'fout' ? 'alert' : undefined}>
      <p className="db-melding-titel">{titel}</p>
      {children && <p className="db-melding-tekst">{children}</p>}
      {actie && <div className="db-melding-actie">{actie}</div>}
    </div>
  );
}

/** Laadstaat (Suspense-fallback): grijze balkjes in de vorm van de inhoud. */
export function KaartSkelet({ label, regels = 3, className = '' }: { label: string; regels?: number; className?: string }) {
  return (
    <section className={`db-kaart ${className}`} aria-label={label} aria-busy="true">
      <header className="db-kaart-kop">
        <h2 className="db-label">{label}</h2>
      </header>
      <div className="db-kaart-inhoud">
        <div className="db-skelet db-skelet-groot" />
        {Array.from({ length: regels }, (_, i) => (
          <div key={i} className="db-skelet" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    </section>
  );
}
