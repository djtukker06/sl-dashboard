import Link from 'next/link';
import { ModuleKop } from '@/components/shell/ModuleKop';

/** Schakelaar Klanten | Projecten bovenin de module (gewone links, geen client-JS). */
export function CrmSegment({ actief }: { actief: 'klanten' | 'projecten' }) {
  return (
    <nav className="ag-segment kp-segment" aria-label="Klanten of projecten">
      <Link href="/klanten" className={actief === 'klanten' ? 'is-aan' : ''} aria-current={actief === 'klanten' ? 'page' : undefined}>
        Klanten
      </Link>
      <Link href="/projecten" className={actief === 'projecten' ? 'is-aan' : ''} aria-current={actief === 'projecten' ? 'page' : undefined}>
        Projecten
      </Link>
    </nav>
  );
}

/** Kop van de overzichten /klanten en /projecten. */
export function CrmKop({ actief, children }: { actief: 'klanten' | 'projecten'; children?: React.ReactNode }) {
  return (
    <ModuleKop label="Klanten & projecten" titel={actief === 'klanten' ? 'Klanten' : 'Projecten'}>
      <CrmSegment actief={actief} />
      {children}
    </ModuleKop>
  );
}

/** "Nog niet ingericht": migratie 0021 of 0022 ontbreekt nog. */
export function CrmNietIngericht({ actief }: { actief: 'klanten' | 'projecten' }) {
  return (
    <>
      <CrmKop actief={actief} />
      <div className="kp">
        <div className="db-melding db-melding-setup">
          <p className="db-melding-titel">Klanten &amp; projecten nog niet ingericht</p>
          <p className="db-melding-tekst">
            Deze pagina werkt zodra migratie 0022 is uitgevoerd. Voer in Supabase (SQL Editor){' '}
            <code>supabase/migrations/0022_team_crm.sql</code> uit (na 0021) en ververs daarna deze pagina. Facturen en klanten in
            Boekhouding werken gewoon door.
          </p>
          <div className="db-melding-actie">
            <Link className="db-knop" href="/facturen">
              Naar facturen
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
