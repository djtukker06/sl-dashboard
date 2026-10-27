import { BoekhoudingKop } from './BoekhoudingKop';

// Getoond zolang migratie 0027 (de boekhoudtabellen) nog niet is uitgevoerd. Bewust géén
// voorbeeldgegevens: de echte boekhouding begint pas als de tabellen er zijn.
export function NietIngerichtMelding() {
  return (
    <p className="bh-leeg bh-overzicht" role="status">
      De boekhouding is nog niet ingericht. Voer in Supabase <code>supabase/UITVOEREN_0027.sql</code> uit; daarna
      verschijnen hier de boekingen, btw-aangiften, activa en rapporten.
    </p>
  );
}

export function NietIngericht({ titel }: { titel: React.ReactNode }) {
  return (
    <div className="bh">
      <BoekhoudingKop titel={titel} />
      <NietIngerichtMelding />
    </div>
  );
}
