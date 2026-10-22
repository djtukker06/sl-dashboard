import Link from 'next/link';
import { icoonSvg, type IcoonNaam } from '@/lib/shell/iconen';

// Nette tussenpagina voor een module die nog wordt gebouwd: zelfde kop en huisstijl
// als de rest, met één duidelijke weg terug.
export function Binnenkort({
  icoon,
  titel,
  tekst,
  punten
}: {
  icoon: IcoonNaam;
  titel: string;
  tekst: string;
  punten: string[];
}) {
  return (
    <div className="sl-binnenkort">
      <span className="sl-binnenkort-icoon" dangerouslySetInnerHTML={{ __html: icoonSvg(icoon, 28) }} />
      <p className="db-label">In opbouw</p>
      <h2>{titel}</h2>
      <p className="sl-binnenkort-tekst">{tekst}</p>
      <ul>
        {punten.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <Link className="db-knop" href="/">
        ← Naar het dashboard
      </Link>
    </div>
  );
}
