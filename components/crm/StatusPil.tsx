import { KLANT_STATUS_LABEL, PROJECT_STATUS_KORT, PROJECT_STATUS_LABEL } from '@/lib/crm/types';
import { opvolgStand, opvolgTekst } from '@/lib/crm/opvolging';

const LABELS: Record<string, string> = { ...KLANT_STATUS_LABEL, ...PROJECT_STATUS_KORT };
const TITELS: Record<string, string> = PROJECT_STATUS_LABEL;

/**
 * Statuslabel van een klant (lead/actief/afgerond) of project (voorbereiding/bezig/
 * wachten/afgerond; "Wachten" voluit als tooltip). Overal dezelfde kleuren (klanten.css):
 * blauw = nog niet begonnen (lead, voorbereiding), groen = loopt (actief, bezig),
 * oker = wacht op een ander, grijs = klaar. Kleur is nooit de enige drager: er staat
 * altijd een label bij.
 */
export function StatusPil({ status, klein = false }: { status: string; klein?: boolean }) {
  const titel = TITELS[status] && TITELS[status] !== LABELS[status] ? TITELS[status] : undefined;
  return (
    <span className={`kp-pil kp-pil-${status}${klein ? ' kp-pil-klein' : ''}`} title={titel}>
      <span className="kp-pil-stip" aria-hidden="true" />
      {LABELS[status] ?? status}
    </span>
  );
}

/** Voortgang "3/7" met een balkje (afgeronde taken van het totaal). */
export function Voortgang({ open, totaal, kaal = false }: { open: number; totaal: number; kaal?: boolean }) {
  const klaar = totaal - open;
  const pct = totaal ? Math.round((klaar / totaal) * 100) : 0;
  return (
    <span className={`kp-voortgang${pct === 100 ? ' is-klaar' : ''}`} title={totaal ? `${klaar} van ${totaal} taken klaar` : 'Nog geen taken'}>
      <span className="kp-voortgang-balk" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      {!kaal && (
        <span className="kp-voortgang-tekst">
          {klaar}/{totaal}
        </span>
      )}
    </span>
  );
}

/** Opvolgdatum als badge: rood = te laat, zand = vandaag, oker = binnen 7 dagen. */
export function OpvolgBadge({ datum, vandaag, leeg }: { datum: string | null; vandaag: string; leeg?: string }) {
  const stand = opvolgStand(datum, vandaag);
  if (!datum || !stand) return leeg ? <span className="kp-badge is-geen">{leeg}</span> : null;
  return (
    <span className={`kp-badge is-${stand}`} title={`Opvolgen op ${datum}`}>
      {opvolgTekst(datum, vandaag)}
    </span>
  );
}
