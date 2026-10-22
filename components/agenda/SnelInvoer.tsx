'use client';

import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { parseSnelinvoer, type TokenSoort } from '@/lib/agenda/snelinvoer';
import { agendaApi, ApiFout, vindKlant, zoekKlanten, type KlantSuggestie } from '@/lib/agenda/client';
import { dagTekst } from '@/lib/agenda/datum';
import type { Afspraak, Taak } from '@/lib/agenda/types';
import { useToast } from './Toast';

export type SnelStandaard = { datum?: string; tijd?: string; soort?: 'taak' | 'afspraak' };

const PLACEHOLDER = 'Wat moet er gebeuren? Bijv. ‘Offerte sturen @Jansen vrijdag 14:00 !’';

/**
 * Eén regel om een taak of afspraak in te voeren. Wat herkend wordt (datum, tijd, duur,
 * prioriteit, klant) verschijnt live als chip; × op een chip maakt het weer gewone tekst.
 * Enter = opslaan, Esc = leegmaken (of sluiten in een popover).
 */
export const SnelInvoer = forwardRef<
  HTMLInputElement,
  {
    vandaag: string;
    id?: string;
    standaard?: SnelStandaard;
    placeholder?: string;
    compact?: boolean;
    autoFocus?: boolean;
    onKlaar?: (r: { taak?: Taak; afspraak?: Afspraak }) => void;
    onAnnuleer?: () => void;
    onNietIngericht?: () => void;
  }
>(function SnelInvoer(
  { vandaag, id, standaard, placeholder = PLACEHOLDER, compact, autoFocus, onKlaar, onAnnuleer, onNietIngericht },
  ref
) {
  const toast = useToast();
  const [tekst, setTekst] = useState('');
  const [negeer, setNegeer] = useState<TokenSoort[]>([]);
  const [klant, setKlant] = useState<{ id: string; naam: string } | null>(null);
  const [soortKeuze, setSoortKeuze] = useState<'taak' | 'afspraak' | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [caret, setCaret] = useState(0);
  const [suggesties, setSuggesties] = useState<{ voor: string; lijst: KlantSuggestie[] }>({ voor: '', lijst: [] });
  const [actief, setActief] = useState(0);
  const hintId = useId();
  const lijstId = useId();
  const eigenRef = useRef<HTMLInputElement | null>(null);

  const r = useMemo(() => parseSnelinvoer(tekst, vandaag, { negeer }), [tekst, vandaag, negeer]);

  // Bepaalt het @woord waar de cursor in staat (voor klant-suggesties).
  const atWoord = useMemo(() => {
    const m = tekst.slice(0, caret).match(/(?:^|\s)@([^\s@"]*)$/);
    return m && !klant ? m[1] : null;
  }, [tekst, caret, klant]);

  useEffect(() => {
    if (!atWoord) return;
    let weg = false;
    const t = setTimeout(async () => {
      const lijst = await zoekKlanten(atWoord);
      if (!weg) {
        setSuggesties({ voor: atWoord, lijst: lijst.slice(0, 6) });
        setActief(0);
      }
    }, 150);
    return () => {
      weg = true;
      clearTimeout(t);
    };
  }, [atWoord]);

  const zichtbareSuggesties = atWoord && suggesties.voor === atWoord ? suggesties.lijst : [];

  const soort = soortKeuze ?? (r.tokens.some((t) => t.soort === 'soort') || r.eindTijd ? r.soort : (standaard?.soort ?? r.soort));
  const datum = r.datum ?? standaard?.datum ?? null;
  const tijd = r.tijd ?? standaard?.tijd ?? null;

  function zetRef(el: HTMLInputElement | null) {
    eigenRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }

  function leeg() {
    setTekst('');
    setNegeer([]);
    setKlant(null);
    setSoortKeuze(null);
    setFout('');
    setCaret(0);
  }

  function kiesKlant(k: KlantSuggestie) {
    // Het @woord uit de tekst halen; de klant wordt een chip.
    const voor = tekst.slice(0, caret).replace(/@([^\s@"]*)$/, '');
    const na = tekst.slice(caret).replace(/^\S*/, '');
    const nieuw = (voor + na).replace(/\s{2,}/g, ' ');
    setTekst(nieuw);
    setCaret(voor.length);
    setKlant({ id: k.id, naam: k.company_name });
    requestAnimationFrame(() => {
      eigenRef.current?.focus();
      eigenRef.current?.setSelectionRange(voor.length, voor.length);
    });
  }

  async function opslaan() {
    if (bezig) return;
    const titel = r.titel.trim();
    if (!titel) {
      setFout(tekst.trim() ? 'Geef de taak ook een omschrijving.' : 'Typ eerst wat er moet gebeuren.');
      return;
    }
    setBezig(true);
    setFout('');
    try {
      let klantId = klant?.id ?? null;
      let klantMelding = '';
      if (!klantId && r.klant) {
        const k = await vindKlant(r.klant);
        if (k) klantId = k.id;
        else klantMelding = ` · klant ‘${r.klant}’ niet gevonden`;
      }
      if (soort === 'afspraak') {
        const d = datum ?? vandaag;
        const { event } = await agendaApi.maakAfspraak(
          tijd
            ? { titel, datum: d, start: tijd, eind: r.eindTijd, duur: r.duur, klantId }
            : { titel, datum: d, heleDag: true, klantId }
        );
        toast(`Afspraak toegevoegd · ${dagTekst(d, vandaag)}${tijd ? ` ${tijd}` : ''}${klantMelding}`);
        onKlaar?.({ afspraak: event });
      } else {
        const { task } = await agendaApi.maakTaak({
          titel,
          datum,
          tijd: datum ? tijd : null,
          duur: r.duur,
          prioriteit: r.prioriteit ?? 2,
          klantId
        });
        toast(
          `Taak toegevoegd${datum ? ` · ${dagTekst(datum, vandaag)}` : ' · zonder datum'}${tijd && datum ? ` ${tijd}` : ''}${klantMelding}`
        );
        onKlaar?.({ taak: task });
      }
      leeg();
    } catch (e) {
      if (e instanceof ApiFout && e.nietIngericht) {
        setFout('De agenda is nog niet ingericht: voer eerst de SQL uit (zie README).');
        onNietIngericht?.();
      } else {
        setFout(e instanceof Error ? e.message : 'Opslaan mislukt.');
      }
    } finally {
      setBezig(false);
    }
  }

  const chips = r.tokens.filter((t) => t.soort !== 'soort');
  const toonVoorbeeld = !!tekst.trim();

  return (
    <div className={`ag-snel${compact ? ' ag-snel-compact' : ''}`}>
      <div className="ag-snel-rij">
        <span className="ag-snel-plus" aria-hidden="true">
          +
        </span>
        <input
          ref={zetRef}
          id={id}
          className="ag-snel-veld"
          type="text"
          placeholder={placeholder}
          aria-label="Nieuwe taak of afspraak"
          aria-describedby={hintId}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={zichtbareSuggesties.length > 0}
          aria-controls={lijstId}
          aria-autocomplete="list"
          value={tekst}
          disabled={bezig}
          maxLength={400}
          onChange={(e) => {
            setTekst(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            if (!e.target.value) {
              setNegeer([]);
              setSoortKeuze(null);
            }
            if (fout) setFout('');
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (zichtbareSuggesties.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActief((a) => (a + 1) % zichtbareSuggesties.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActief((a) => (a - 1 + zichtbareSuggesties.length) % zichtbareSuggesties.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                kiesKlant(zichtbareSuggesties[actief] ?? zichtbareSuggesties[0]);
                return;
              }
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void opslaan();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              if (tekst || klant) leeg();
              else if (onAnnuleer) onAnnuleer();
              else e.currentTarget.blur();
            }
          }}
        />
        {toonVoorbeeld && (
          <button
            type="button"
            className="ag-snel-soort"
            title="Wisselen tussen taak en afspraak"
            onClick={() => setSoortKeuze(soort === 'taak' ? 'afspraak' : 'taak')}
          >
            {soort === 'taak' ? 'Taak' : 'Afspraak'}
          </button>
        )}
        <button type="button" className="db-knop db-knop-primair ag-snel-knop" disabled={bezig} onClick={() => void opslaan()}>
          {bezig ? 'Bezig…' : 'Toevoegen'}
        </button>
      </div>

      {zichtbareSuggesties.length > 0 && (
        <ul className="ag-suggesties ag-snel-suggesties" id={lijstId} role="listbox" aria-label="Klanten">
          {zichtbareSuggesties.map((k, i) => (
            <li key={k.id} role="option" aria-selected={i === actief}>
              <button
                type="button"
                className="ag-suggestie"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => kiesKlant(k)}
              >
                {k.company_name}
                {k.contact_name && <span className="ag-suggestie-sub">t.a.v. {k.contact_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ag-snel-chips" id={hintId} aria-live="polite">
        {fout ? (
          <span className="ag-snel-fout" role="alert">
            {fout}
          </span>
        ) : toonVoorbeeld || klant ? (
          <>
            {!r.datum && standaard?.datum && (
              <span className="ag-chip ag-chip-zacht">{dagTekst(standaard.datum, vandaag)}</span>
            )}
            {!r.tijd && standaard?.tijd && <span className="ag-chip ag-chip-zacht">{standaard.tijd}</span>}
            {chips.map((t) => (
              <span key={t.soort} className={`ag-chip ag-chip-${t.soort}`}>
                {t.soort === 'klant' ? '@' : ''}
                {t.label}
                <button
                  type="button"
                  className="ag-chip-x"
                  aria-label={`‘${t.tekst}’ niet herkennen`}
                  title="Als gewone tekst houden"
                  onClick={() => setNegeer((n) => [...n, t.soort])}
                >
                  ×
                </button>
              </span>
            ))}
            {klant && (
              <span className="ag-chip ag-chip-klant">
                @{klant.naam}
                <button type="button" className="ag-chip-x" aria-label="Klant weghalen" onClick={() => setKlant(null)}>
                  ×
                </button>
              </span>
            )}
            {!chips.length && !klant && !standaard?.datum && (
              <span className="ag-snel-hint">
                {soort === 'taak' ? 'Taak zonder datum — komt onder ‘Ooit’' : 'Afspraak vandaag, hele dag'}
              </span>
            )}
          </>
        ) : (
          !compact && (
            <span className="ag-snel-hint">
              Herkent <b>morgen</b>, <b>vrijdag 14:00</b>, <b>12 nov</b>, <b>10:00-11:00</b>, <b>1u</b>, <b>@klant</b> en{' '}
              <b>!</b> voor hoge prioriteit. Begin met <b>afspraak</b> voor een afspraak.
            </span>
          )
        )}
      </div>
    </div>
  );
});
