'use client';

import { useEffect, useRef, useState } from 'react';
import { langeDatum, vergrendeldReden } from '@/lib/boekhouding/kern/periode';
import { BkApiFout, bkApi } from '@/lib/boekhouding/client';
import type { Boeking, Stamdata } from '@/lib/boekhouding/model';
import type { Centen } from '@/lib/boekhouding/kern/geld';
import type { KoppelBron } from '@/lib/boekhouding/kern/bronnen';
import { BoekingFormulier, Uitkomst, formulierNaarBody, formulierUit, rekenUit, type Formulier } from './BoekingFormulier';
import { KoppelSuggesties, type KoppelInfo } from './KoppelSuggesties';

// Zijpaneel van één boekingsregel: bekijken, wijzigen en (met reden) verwijderen. In een
// vergrendelde periode (aangifte ingediend / boekjaar afgesloten) zijn alleen de notities en
// de status te wijzigen; de rest staat vast. Een uitgave of inkomst kun je hier afletteren
// tegen een bonnetje of factuur (suggesties met één klik).
export function BoekingPaneel({
  stam,
  boeking,
  naamBank,
  onSluit,
  onOpgeslagen,
  onVerwijderd,
  koppel,
  onKoppel,
  onOntkoppel
}: {
  stam: Stamdata;
  boeking: Boeking;
  naamBank: string;
  onSluit: () => void;
  onOpgeslagen: (b: Boeking) => void;
  onVerwijderd: (id: string) => void;
  koppel?: KoppelInfo;
  onKoppel?: (bron: KoppelBron, bronId: string, bedrag?: Centen) => Promise<void>;
  onOntkoppel?: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState<Formulier>(() => formulierUit(boeking));
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [verwijderen, setVerwijderen] = useState(false);
  const [reden, setReden] = useState('');
  const paneel = useRef<HTMLElement>(null);
  const slot = vergrendeldReden(boeking.datum, stam.vergrendeling);
  const u = rekenUit(stam, form);
  const gekoppeld = Boolean(koppel && koppel.koppelingen.length > 0);

  useEffect(() => {
    const toets = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSluit();
    };
    window.addEventListener('keydown', toets);
    paneel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => window.removeEventListener('keydown', toets);
  }, [onSluit]);

  async function opslaan(extra?: Record<string, unknown>) {
    setBezig(true);
    setFout(null);
    setFouten({});
    try {
      const body = slot ? { notities: form.notities || null, status: 'geboekt', ...extra } : { ...formulierNaarBody(form), ...extra };
      const { boeking: b } = await bkApi<{ boeking: Boeking }>(`/api/boekhouding/boekingen/${boeking.id}`, { method: 'PATCH', body });
      onOpgeslagen(b);
      setForm(formulierUit(b));
    } catch (e) {
      const f = e as BkApiFout;
      if (f.veld) setFouten({ [f.veld]: f.message });
      setFout(f.message);
    } finally {
      setBezig(false);
    }
  }

  async function weg() {
    setBezig(true);
    setFout(null);
    try {
      await bkApi(`/api/boekhouding/boekingen/${boeking.id}`, { method: 'DELETE', body: { reden } });
      onVerwijderd(boeking.id);
    } catch (e) {
      setFout((e as Error).message);
      setBezig(false);
    }
  }

  return (
    <>
      <div className="ag-paneel-achter" onClick={onSluit} aria-hidden="true" />
      <aside ref={paneel} className="ag-paneel bh-paneel" role="dialog" aria-modal="true" aria-labelledby="bh-paneel-titel">
        <form
          className="ag-paneel-form"
          onSubmit={(e) => {
            e.preventDefault();
            void opslaan();
          }}
        >
          <header className="ag-paneel-kop">
            <div>
              <p className="bh-label">
                {naamBank} · {langeDatum(boeking.datum)}
              </p>
              <h2 id="bh-paneel-titel" className="bh-paneel-titel">
                {boeking.omschrijving}
              </h2>
            </div>
            <button type="button" className="ag-icoonknop" onClick={onSluit} aria-label="Sluiten">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div className="ag-paneel-inhoud">
            {slot && (
              <p className="bh-slot-melding">
                <strong>Vergrendeld.</strong> {slot} Alleen de notities zijn nog te wijzigen; een correctie boek je als nieuwe regel in een open periode.
              </p>
            )}
            {boeking.status === 'te_verwerken' && !slot && (
              <p className="bh-uitkomst-noot is-let-op">
                Deze regel moet nog worden gecontroleerd. Koppel hem aan een factuur of bonnetje, of controleer de soort, btw en categorie en klik op Opslaan.
              </p>
            )}
            {koppel && onKoppel && onOntkoppel && <KoppelSuggesties info={koppel} onKoppel={onKoppel} onOntkoppel={onOntkoppel} />}
            {gekoppeld && (
              <p className="bh-uitkomst-noot">
                Deze regel is de betaling; omzet of kosten en de btw komen uit de {koppel?.bron === 'factuur' ? 'factuur' : 'het bonnetje'} (factuurstelsel: in het kwartaal van de
                {koppel?.bron === 'factuur' ? ' factuurdatum' : ' bondatum'}). Soort, bedrag en bank liggen vast zolang hij gekoppeld is.
              </p>
            )}
            <BoekingFormulier stam={stam} waarde={form} onWijzig={setForm} layout="paneel" fouten={fouten} alleenLezen={Boolean(slot)} />
            {slot && (
              <label className="bh-veld">
                <span className="bh-label">Notities</span>
                <textarea className="ag-veld" rows={3} value={form.notities} onChange={(e) => setForm({ ...form, notities: e.target.value })} maxLength={2000} />
              </label>
            )}
            {!gekoppeld && <Uitkomst u={{ ...u, slot: null }} />}
            {fout && <p className="ag-fout">{fout}</p>}
          </div>

          <footer className="ag-paneel-voet">
            {verwijderen ? (
              <div className="bh-verwijder">
                <label className="bh-veld">
                  <span className="bh-label">Reden van verwijderen</span>
                  <input className="ag-veld" value={reden} onChange={(e) => setReden(e.target.value)} placeholder="bv. dubbel geboekt" maxLength={300} autoFocus />
                </label>
                <div className="ag-paneel-acties">
                  <button type="button" className="db-knop" onClick={() => setVerwijderen(false)}>
                    Annuleren
                  </button>
                  <button type="button" className="db-knop ag-knop-gevaar" onClick={weg} disabled={bezig || !reden.trim()}>
                    Verwijderen
                  </button>
                </div>
              </div>
            ) : (
              <>
                {!slot ? (
                  <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => setVerwijderen(true)}>
                    Verwijderen
                  </button>
                ) : (
                  <span />
                )}
                <div className="ag-paneel-acties">
                  <button type="button" className="db-knop" onClick={onSluit}>
                    Sluiten
                  </button>
                  <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
                    {bezig ? 'Bezig…' : 'Opslaan'}
                  </button>
                </div>
              </>
            )}
          </footer>
        </form>
      </aside>
    </>
  );
}
