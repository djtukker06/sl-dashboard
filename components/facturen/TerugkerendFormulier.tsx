'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ClientCombobox } from '@/components/ClientCombobox';
import { bedrijf } from '@/lib/config';
import { formatEuro, parseBedrag } from '@/lib/format';
import { BTW_VERLEGD_TEKST, LEGE_REGEL, type BtwVerlegdAls, type RegelInvoer } from '@/lib/invoice/formulier';
import {
  INTERVAL_LABEL,
  INTERVALLEN,
  PLACEHOLDERS,
  STANDAARD_BERICHT,
  STANDAARD_ONDERWERP,
  datumKort,
  eersteDatum,
  isEchteDatum,
  periodeBereik,
  periodeLabel,
  ritme,
  schuifOp,
  vulIn,
  type Interval
} from '@/lib/invoice/terugkerend-kern';
import type { TerugkerendDto } from '@/lib/invoice/terugkerend-beheer';
import { Keuzelijst } from './Keuzelijst';

export interface InboxKeuze {
  id: string;
  label: string;
  email: string;
}

/** De middelste kolom die automatisch de periode toont ("1/12/2026 t/m 31/12/2026"). */
const AUTO_PERIODE = '{periode}';

const DAGEN = Array.from({ length: 28 }, (_, i) => ({ waarde: i + 1, label: i === 0 ? '1 (eerste dag van de maand)' : String(i + 1) }));

// Een terugkerende factuur aanmaken (Nieuwe factuur → Terugkerend) of wijzigen
// (/facturen/terugkerend/[id]). Drie blokken in de volgorde waarin je erover nadenkt: wat
// (klant, regels, btw), wanneer (ritme en eerstvolgende datum) en versturen (e-mail). Onderaan
// staat steeds wat er gaat gebeuren, met de teksten zoals ze op de eerstvolgende factuur komen.
export function TerugkerendFormulier({ sjabloon, inboxen, vandaag }: { sjabloon?: TerugkerendDto; inboxen: InboxKeuze[]; vandaag: string }) {
  const router = useRouter();
  const bewerken = Boolean(sjabloon);

  const [klantNaam, setKlantNaam] = useState(sjabloon?.klantNaam ?? '');
  const [klantTav, setKlantTav] = useState(sjabloon?.klantTav ?? '');
  const [klantAdres, setKlantAdres] = useState(sjabloon?.klantAdres ?? '');
  const [klantPostcode, setKlantPostcode] = useState(sjabloon?.klantPostcode ?? '');
  const [naam, setNaam] = useState(sjabloon?.naam ?? '');
  const [regels, setRegels] = useState<RegelInvoer[]>(
    sjabloon?.regels.length
      ? sjabloon.regels.map((r) => ({ beschrijving: r.beschrijving, midden: r.midden, totaal: formatEuro(r.totaal), teltMeeInOmzet: r.teltMeeInOmzet }))
      : [{ ...LEGE_REGEL, midden: AUTO_PERIODE }]
  );
  const [middenKolomLabel, setMiddenKolomLabel] = useState(sjabloon?.middenKolomLabel ?? 'Periode');
  const [btwVerlegd, setBtwVerlegd] = useState(sjabloon?.btwVerlegd ?? false);
  const [btwVerlegdAls, setBtwVerlegdAls] = useState<BtwVerlegdAls>(sjabloon?.btwVerlegdAls ?? 'verlegd');
  const [btwVerlegdReden, setBtwVerlegdReden] = useState(sjabloon?.btwVerlegdReden ?? '');

  const [interval, setIntervalKeuze] = useState<Interval>(sjabloon?.interval ?? 'maand');
  const [dag, setDag] = useState(sjabloon?.dag ?? 1);
  const [volgendeDatum, setVolgendeDatum] = useState(sjabloon?.volgendeDatum ?? eersteDatum(vandaag, 1));
  const [eindDatum, setEindDatum] = useState(sjabloon?.eindDatum ?? '');

  const [versturen, setVersturen] = useState(sjabloon?.versturen ?? true);
  const [emailAan, setEmailAan] = useState(sjabloon?.emailAan ?? '');
  const [emailCc, setEmailCc] = useState(sjabloon?.emailCc ?? '');
  const [mailboxId, setMailboxId] = useState(sjabloon?.mailboxId || inboxen[0]?.id || '');
  const [onderwerp, setOnderwerp] = useState(sjabloon?.onderwerp ?? STANDAARD_ONDERWERP);
  const [bericht, setBericht] = useState(sjabloon?.bericht ?? STANDAARD_BERICHT);
  const [akkoordVereist, setAkkoordVereist] = useState(sjabloon?.akkoordVereist ?? true);

  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  // Een inbox van een collega die jij niet ziet, blijft gewoon gekozen staan.
  const inboxOpties = [
    ...(mailboxId && !inboxen.some((i) => i.id === mailboxId) ? [{ waarde: mailboxId, label: 'Inbox van een collega (ongewijzigd)' }] : []),
    ...inboxen.map((i) => ({ waarde: i.id, label: i.label, sub: i.email }))
  ];

  function kiesDag(n: number) {
    setDag(n);
    // De eerstvolgende datum loopt mee met de gekozen dag (de eerstvolgende keer vanaf vandaag).
    setVolgendeDatum(eersteDatum(vandaag, n));
  }

  function wijzigRegel(i: number, veld: keyof RegelInvoer, waarde: string | boolean) {
    setRegels((prev) => prev.map((r, j) => (j === i ? { ...r, [veld]: waarde } : r)));
  }

  const subtotaal = regels.reduce((som, r) => som + (r.beschrijving.trim() ? parseBedrag(r.totaal || '0') : 0), 0);
  const btw = btwVerlegd ? 0 : Math.round(subtotaal * bedrijf.btwPercentage) / 100;
  const datumGeldig = isEchteDatum(volgendeDatum);
  const bereik = datumGeldig ? periodeBereik(volgendeDatum, interval, dag) : '';

  const voorbeeld = useMemo(() => {
    if (!datumGeldig) return null;
    const p = { datum: volgendeDatum, interval, dag, klant: klantTav.trim() || klantNaam.trim() || 'de klant', factuurnummer: '26-0XX', bedrag: `€ ${formatEuro(subtotaal + btw)}` };
    return {
      periode: periodeLabel(volgendeDatum, interval),
      daarna: [1, 2].map((n) => datumKort(schuifOp(volgendeDatum, interval, dag, n))),
      regels: regels.filter((r) => r.beschrijving.trim()).map((r) => `${vulIn(r.beschrijving, p)}${r.midden.trim() ? ` · ${vulIn(r.midden, p)}` : ''}`),
      onderwerp: vulIn(onderwerp, p),
      bericht: vulIn(bericht, p)
    };
  }, [datumGeldig, volgendeDatum, interval, dag, klantNaam, klantTav, subtotaal, btw, regels, onderwerp, bericht]);

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    try {
      const res = await fetch(bewerken ? `/api/terugkerend/${sjabloon!.id}` : '/api/terugkerend', {
        method: bewerken ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          klant: { bedrijfsnaam: klantNaam, tav: klantTav, adres: klantAdres, postcode: klantPostcode },
          naam,
          regels,
          middenKolomLabel,
          btwVerlegd,
          btwVerlegdAls,
          btwVerlegdReden,
          interval,
          dag,
          volgendeDatum,
          eindDatum: eindDatum || null,
          actief: sjabloon?.actief ?? true,
          versturen,
          emailAan,
          emailCc,
          mailboxId,
          onderwerp,
          bericht,
          akkoordVereist
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFout(data.error || 'Opslaan mislukt.');
        setBezig(false);
        return;
      }
      router.push('/facturen/terugkerend');
      router.refresh();
    } catch {
      setFout('Geen verbinding met de server. Controleer je internet en probeer het opnieuw.');
      setBezig(false);
    }
  }

  return (
    <form className="tk-form" onSubmit={opslaan}>
      {fout && <div className="foutmelding">{fout}</div>}

      <section className="card">
        <h2>Klantgegevens</h2>
        <div className="grid-2">
          <ClientCombobox
            value={klantNaam}
            onChange={setKlantNaam}
            onSelectClient={(k) => {
              setKlantNaam(k.company_name);
              setKlantTav(k.contact_name || '');
              setKlantAdres(k.address || '');
              setKlantPostcode(k.postal_code || '');
              // Het e-mailadres van de klant voorinvullen, zolang je er zelf nog niets hebt getypt.
              if (k.email && !emailAan.trim()) setEmailAan(k.email);
            }}
          />
          <label>
            T.a.v. (naam eigenaar/contactpersoon) (optioneel)
            <input type="text" value={klantTav} onChange={(e) => setKlantTav(e.target.value)} />
          </label>
          <label>
            Adres (straat + huisnummer, plaats) (optioneel)
            <input type="text" value={klantAdres} onChange={(e) => setKlantAdres(e.target.value)} />
          </label>
          <label>
            Postcode (optioneel)
            <input type="text" value={klantPostcode} onChange={(e) => setKlantPostcode(e.target.value)} />
          </label>
        </div>
        <p className="veld-hint">
          Typ een paar letters en kies de klant: de bekende gegevens worden ingevuld. Wijzigingen worden net als bij een gewone factuur bij de klant
          bewaard, en elke factuur gebruikt de gegevens die op dat moment bij de klant staan.
        </p>
      </section>

      <section className="card">
        <h2>Factuurregels</h2>
        <label className="naam-tk">
          Naam (voor je eigen overzicht en de bestandsnaam van de PDF)
          <input type="text" required value={naam} maxLength={200} placeholder="Bijv. Onderhoudspakket" onChange={(e) => setNaam(e.target.value)} />
        </label>
        <label className="mid-label-input">
          Naam van de middelste kolom (optioneel)
          <input type="text" value={middenKolomLabel} onChange={(e) => setMiddenKolomLabel(e.target.value)} />
        </label>
        <table className="regels-table">
          <thead>
            <tr>
              <th>Beschrijving</th>
              <th className="mid-col">{middenKolomLabel.trim() || 'Periode / aantal'}</th>
              <th>Bedrag excl. btw (€)</th>
              <th className="omzet-col" title="Alleen voor je eigen omzetcijfer — dit komt niet op de factuur">
                Omzet
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {regels.map((regel, i) => (
              <tr key={i}>
                <td>
                  <input type="text" value={regel.beschrijving} placeholder="Bijv. Onderhoud en hosting website" onChange={(e) => wijzigRegel(i, 'beschrijving', e.target.value)} />
                </td>
                <td className="mid-col">
                  {regel.midden === AUTO_PERIODE ? (
                    <div className="tk-auto-periode" title="Wordt per factuur ingevuld met de periode uit Wanneer">
                      <span>{bereik || 'periode'}</span>
                      <button type="button" className="ag-link-knop" onClick={() => wijzigRegel(i, 'midden', '')}>
                        Zelf invullen
                      </button>
                    </div>
                  ) : (
                    <div className="tk-midden">
                      <input type="text" value={regel.midden} onChange={(e) => wijzigRegel(i, 'midden', e.target.value)} />
                      <button type="button" className="ag-link-knop" title="De periode automatisch invullen" onClick={() => wijzigRegel(i, 'midden', AUTO_PERIODE)}>
                        Automatisch
                      </button>
                    </div>
                  )}
                </td>
                <td>
                  <input type="text" required inputMode="decimal" value={regel.totaal} onChange={(e) => wijzigRegel(i, 'totaal', e.target.value)} />
                </td>
                <td className="omzet-col">
                  <input type="checkbox" checked={regel.teltMeeInOmzet} onChange={(e) => wijzigRegel(i, 'teltMeeInOmzet', e.target.checked)} />
                </td>
                <td>
                  <button type="button" className="verwijder-regel" title="Regel verwijderen" onClick={() => setRegels((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}>
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn-secundair" onClick={() => setRegels((prev) => [...prev, { ...LEGE_REGEL, midden: AUTO_PERIODE }])}>
          + Regel toevoegen
        </button>
        <p className="veld-hint">
          De periode in de middelste kolom volgt vanzelf uit <strong>Wanneer</strong>: bij elke factuur staat er de periode waar hij over gaat. In een
          beschrijving kun je ook <code>{'{periodenaam}'}</code> (bijv. &quot;december 2026&quot;), <code>{'{maand}'}</code> of <code>{'{jaar}'}</code> gebruiken.
        </p>

        <label className="checkbox-regel tk-btw">
          <input type="checkbox" checked={btwVerlegd} onChange={(e) => setBtwVerlegd(e.target.checked)} />
          <span>Btw verlegd — geen btw op deze factuur</span>
        </label>
        {btwVerlegd && (
          <>
            <fieldset className="btw-weergave-keuze">
              <legend>Op de factuur bij Btw</legend>
              {(Object.keys(BTW_VERLEGD_TEKST) as BtwVerlegdAls[]).map((optie) => (
                <label key={optie} className="checkbox-regel">
                  <input type="radio" name="btwVerlegdAls" checked={btwVerlegdAls === optie} onChange={() => setBtwVerlegdAls(optie)} />
                  <span>{BTW_VERLEGD_TEKST[optie]}</span>
                </label>
              ))}
            </fieldset>
            <label className="reden-input">
              Reden btw verlegd
              <input type="text" value={btwVerlegdReden} onChange={(e) => setBtwVerlegdReden(e.target.value)} />
            </label>
          </>
        )}
        <p className="tk-bedrag">
          Per factuur: <strong>€ {formatEuro(subtotaal)}</strong> excl. btw
          {btwVerlegd ? ' (btw verlegd)' : <> · € {formatEuro(subtotaal + btw)} incl. {bedrijf.btwPercentage}% btw</>}
        </p>
      </section>

      <section className="card">
        <h2>Wanneer</h2>
        <div className="grid-2">
          <div className="tk-veld">
            <span>Hoe vaak</span>
            <Keuzelijst label="Hoe vaak" waarde={interval} opties={INTERVALLEN.map((i) => ({ waarde: i, label: INTERVAL_LABEL[i] }))} onChange={setIntervalKeuze} />
          </div>
          <div className="tk-veld">
            <span>Op dag van de maand</span>
            <Keuzelijst label="Op dag van de maand" waarde={dag} opties={DAGEN} onChange={kiesDag} />
          </div>
          <label>
            Eerstvolgende factuur
            <input type="date" required value={volgendeDatum} min={bewerken ? undefined : vandaag} onChange={(e) => setVolgendeDatum(e.target.value)} />
          </label>
          <label>
            Stoppen na (optioneel)
            <input type="date" value={eindDatum} min={volgendeDatum} onChange={(e) => setEindDatum(e.target.value)} />
          </label>
        </div>
        {bereik && (
          <p className="tk-bedrag">
            Eerste factuur: periode <strong>{bereik}</strong>
          </p>
        )}
        <p className="veld-hint">
          De factuur wordt op die dag &apos;s ochtends vroeg automatisch aangemaakt, met het eerstvolgende factuurnummer (het hoogste nummer van dat
          jaar + 1) en de datum van die dag. Kies een dag tot en met de 28e, zodat hij elke maand bestaat. Laat &quot;Stoppen na&quot; leeg om door te
          lopen tot je hem zelf stopt.
        </p>
      </section>

      <section className="card">
        <h2>Versturen</h2>
        <label className="checkbox-regel">
          <input type="checkbox" checked={versturen} onChange={(e) => setVersturen(e.target.checked)} />
          <span>Automatisch per e-mail versturen, met de PDF als bijlage</span>
        </label>
        {versturen && (
          <>
            <div className="grid-2">
              <label>
                Aan
                <input type="text" required value={emailAan} placeholder="naam@bedrijf.nl" onChange={(e) => setEmailAan(e.target.value)} />
              </label>
              <label>
                Cc (optioneel)
                <input type="text" value={emailCc} placeholder="bijv. je eigen adres" onChange={(e) => setEmailCc(e.target.value)} />
              </label>
              <div className="tk-veld">
                <span>Versturen vanaf</span>
                <Keuzelijst label="Versturen vanaf" waarde={mailboxId} opties={inboxOpties} onChange={setMailboxId} leeg="Geen inbox gekoppeld" />
              </div>
              <label>
                Onderwerp
                <input type="text" value={onderwerp} maxLength={300} onChange={(e) => setOnderwerp(e.target.value)} />
              </label>
            </div>
            <label className="checkbox-regel tk-akkoord-vinkje">
              <input type="checkbox" checked={akkoordVereist} onChange={(e) => setAkkoordVereist(e.target.checked)} />
              <span>Eerst akkoord geven voordat hij verstuurd wordt</span>
            </label>
            <p className="veld-hint tk-akkoord-uitleg">
              {akkoordVereist
                ? 'Een week van tevoren krijg je een melding om de factuur te bekijken en goed te keuren. Zonder akkoord wordt hij op de dag zelf wel aangemaakt, maar pas verstuurd als jij op Versturen klikt.'
                : 'Hij wordt op de dag zelf automatisch aangemaakt en verstuurd, zonder dat je hem eerst ziet.'}
            </p>
            <label className="tk-bericht">
              Bericht
              <textarea rows={7} value={bericht} maxLength={5000} onChange={(e) => setBericht(e.target.value)} />
            </label>
            <p className="veld-hint">
              De handtekening van de gekozen inbox komt er vanzelf onder en een kopie komt in Verzonden. In onderwerp en bericht kun je{' '}
              {PLACEHOLDERS.map((p, i) => (
                <span key={p}>
                  {i ? ', ' : ''}
                  <code>{p}</code>
                </span>
              ))}{' '}
              gebruiken. Meerdere adressen scheid je met een komma.
            </p>
          </>
        )}
        {!versturen && <p className="veld-hint">De factuur wordt alleen aangemaakt; versturen doe je dan zelf.</p>}
      </section>

      {voorbeeld && (
        <section className="card tk-samenvatting">
          <h2>Wat er gaat gebeuren</h2>
          <p>
            Op <strong>{datumKort(volgendeDatum)}</strong> wordt de factuur voor <strong>{voorbeeld.periode}</strong> aangemaakt
            {klantNaam.trim() ? <> voor {klantNaam.trim()}</> : null}
            {versturen && emailAan.trim() ? (
              akkoordVereist ? (
                <> en, na jouw akkoord, verstuurd naar {emailAan.trim()}</>
              ) : (
                <> en verstuurd naar {emailAan.trim()}</>
              )
            ) : null}
            . Daarna {ritme(interval, dag).toLowerCase()}: {voorbeeld.daarna.join(', ')}, …
            {eindDatum ? <> tot en met {datumKort(eindDatum)}</> : null}
          </p>
          {voorbeeld.regels.length > 0 && (
            <ul className="tk-voorbeeld-regels">
              {voorbeeld.regels.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {sjabloon && (
            <p className="veld-hint">
              <a href={`/api/terugkerend/${sjabloon.id}/voorbeeld`} target="_blank" rel="noreferrer">
                Voorbeeld-PDF van de eerstvolgende factuur
              </a>{' '}
              (zoals hij nu is opgeslagen; sla wijzigingen eerst op om ze in het voorbeeld te zien).
            </p>
          )}
          {versturen && (
            <div className="tk-voorbeeld-mail">
              <div className="tk-voorbeeld-onderwerp">{voorbeeld.onderwerp}</div>
              <div className="tk-voorbeeld-tekst">{voorbeeld.bericht}</div>
            </div>
          )}
        </section>
      )}

      {fout && <div className="foutmelding">{fout}</div>}
      <div className="tk-knoppen">
        <button type="submit" className="btn-primair" disabled={bezig}>
          {bezig ? 'Bezig met opslaan…' : bewerken ? 'Wijzigingen opslaan' : 'Terugkerende factuur opslaan'}
        </button>
        <Link href={bewerken ? '/facturen/terugkerend' : '/facturen'} className="btn-secundair">
          Annuleren
        </Link>
      </div>
    </form>
  );
}
