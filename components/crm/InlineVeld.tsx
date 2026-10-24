'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Inline bewerken: de waarde staat er gewoon (eventueel als link); klik op het potlood
 * (of op "+ … toevoegen" als hij leeg is) en je typt op dezelfde plek. Enter of verlaten
 * slaat op, Escape annuleert. `onBewaar` geeft false bij een fout: dan blijft de oude waarde.
 */
export function InlineVeld({
  label,
  waarde,
  onBewaar,
  leeg,
  type = 'text',
  max = 200,
  weergave
}: {
  label: string;
  waarde: string;
  onBewaar: (nieuw: string) => Promise<boolean>;
  /** Tekst als het veld leeg is, bv. "+ Telefoon toevoegen". */
  leeg: string;
  type?: 'text' | 'email' | 'tel';
  max?: number;
  /** Hoe de waarde getoond wordt (bv. als mail- of tel-link). */
  weergave?: (w: string) => React.ReactNode;
}) {
  const [bewerk, setBewerk] = useState(false);
  const [tekst, setTekst] = useState(waarde);
  const [bezig, setBezig] = useState(false);
  const veld = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (bewerk) veld.current?.select();
  }, [bewerk]);

  async function bewaar() {
    const t = tekst.replace(/\s+/g, ' ').trim();
    if (t === waarde) {
      setBewerk(false);
      return;
    }
    setBezig(true);
    const ok = await onBewaar(t);
    setBezig(false);
    if (ok) setBewerk(false);
    else veld.current?.focus();
  }

  if (bewerk) {
    return (
      <input
        ref={veld}
        className="ag-veld kp-inline-veld"
        type={type}
        value={tekst}
        maxLength={max}
        aria-label={label}
        disabled={bezig}
        onChange={(e) => setTekst(e.target.value)}
        onBlur={() => void bewaar()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void bewaar();
          }
          if (e.key === 'Escape') {
            setTekst(waarde);
            setBewerk(false);
          }
        }}
      />
    );
  }

  if (!waarde) {
    return (
      <button
        type="button"
        className="kp-inline-leeg"
        onClick={() => {
          setTekst('');
          setBewerk(true);
        }}
      >
        {leeg}
      </button>
    );
  }

  return (
    <span className="kp-inline">
      <span className="kp-inline-waarde">{weergave ? weergave(waarde) : waarde}</span>
      <button
        type="button"
        className="kp-inline-potlood"
        aria-label={`${label} wijzigen`}
        title={`${label} wijzigen`}
        onClick={() => {
          setTekst(waarde);
          setBewerk(true);
        }}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </button>
    </span>
  );
}

/**
 * De paginatitel (klant- of projectnaam), direct bewerkbaar: klik erop en typ. Leeg of
 * Escape zet de oude naam terug.
 */
export function InlineTitel({ waarde, label, onBewaar, max = 200 }: { waarde: string; label: string; onBewaar: (nieuw: string) => Promise<boolean>; max?: number }) {
  const [bewerk, setBewerk] = useState(false);
  const [tekst, setTekst] = useState(waarde);
  const [getoond, setGetoond] = useState(waarde);
  const veld = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (bewerk) veld.current?.select();
  }, [bewerk]);

  async function bewaar() {
    const t = tekst.replace(/\s+/g, ' ').trim();
    setBewerk(false);
    if (!t || t === getoond) {
      setTekst(getoond);
      return;
    }
    const oud = getoond;
    setGetoond(t);
    if (!(await onBewaar(t))) {
      setGetoond(oud);
      setTekst(oud);
    }
  }

  if (bewerk) {
    return (
      <input
        ref={veld}
        className="kp-titelveld"
        value={tekst}
        maxLength={max}
        aria-label={label}
        onChange={(e) => setTekst(e.target.value)}
        onBlur={() => void bewaar()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setTekst(getoond);
            setBewerk(false);
          }
        }}
      />
    );
  }
  return (
    <button type="button" className="kp-titelknop" title={`${label} wijzigen`} onClick={() => setBewerk(true)}>
      {getoond}
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="kp-titel-potlood">
        <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
