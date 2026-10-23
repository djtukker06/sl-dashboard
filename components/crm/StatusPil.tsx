import { KLANT_STATUS_LABEL, PROJECT_STATUS_KORT, PROJECT_STATUS_LABEL } from '@/lib/crm/types';

const LABELS: Record<string, string> = { ...KLANT_STATUS_LABEL, ...PROJECT_STATUS_KORT };
const TITELS: Record<string, string> = PROJECT_STATUS_LABEL;

/**
 * Statuslabel van een klant (lead/actief/afgerond) of project (voorbereiding/bezig/
 * wachten/afgerond; "Wachten" voluit als tooltip).
 */
export function StatusPil({ status }: { status: string }) {
  const titel = TITELS[status] && TITELS[status] !== LABELS[status] ? TITELS[status] : undefined;
  return (
    <span className={`kp-pil kp-pil-${status}`} title={titel}>
      {LABELS[status] ?? status}
    </span>
  );
}

/** Voortgang "3/7" met een balkje (afgeronde taken van het totaal). */
export function Voortgang({ open, totaal }: { open: number; totaal: number }) {
  const klaar = totaal - open;
  const pct = totaal ? Math.round((klaar / totaal) * 100) : 0;
  return (
    <span className="kp-voortgang" title={totaal ? `${klaar} van ${totaal} taken klaar` : 'Nog geen taken'}>
      <span className="kp-voortgang-balk" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="kp-voortgang-tekst">
        {klaar}/{totaal}
      </span>
    </span>
  );
}
