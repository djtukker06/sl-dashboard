'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/beveiliging/client';

// 2FA instellen in twee stappen: QR-code scannen (of de sleutel overtypen) en de eerste code
// invullen. Gebruikt op /welkom, /beveiliging/instellen en Account › Beveiliging.

interface Start {
  factorId: string;
  naam: string;
  qr: string | null;
  geheim: string;
}

export function TfaInstellen({
  onKlaar,
  onAnnuleren,
  naam,
  autoStart = true
}: {
  onKlaar: () => void;
  onAnnuleren?: () => void;
  /** Naam van het apparaat (bv. "Telefoon", "Wachtwoordmanager"). */
  naam?: string;
  autoStart?: boolean;
}) {
  const [start, setStart] = useState<Start | null>(null);
  const [code, setCode] = useState('');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [toonSleutel, setToonSleutel] = useState(false);
  const gestart = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function begin() {
    setFout('');
    setBezig(true);
    try {
      const s = await api<Start>('/api/beveiliging/2fa/inschrijven', 'POST', { naam });
      setStart(s);
      setCode('');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Starten mislukt.');
    } finally {
      setBezig(false);
    }
  }

  useEffect(() => {
    if (autoStart && !gestart.current) {
      gestart.current = true;
      void begin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen bij openen
  }, []);

  async function bevestig(e: React.FormEvent) {
    e.preventDefault();
    if (!start) return;
    setFout('');
    setBezig(true);
    try {
      await api('/api/beveiliging/2fa/bevestigen', 'POST', { factorId: start.factorId, code });
      onKlaar();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Bevestigen mislukt.');
      setCode('');
      codeRef.current?.focus();
    } finally {
      setBezig(false);
    }
  }

  const sleutelGroepen = start?.geheim.replace(/(.{4})/g, '$1 ').trim() ?? '';

  return (
    <div className="bv-instellen">
      <ol className="bv-uitleg-stappen">
        <li>
          Installeer een authenticator-app op je telefoon, bijvoorbeeld <strong>Google Authenticator</strong>,{' '}
          <strong>Microsoft Authenticator</strong>, of gebruik je wachtwoordmanager (<strong>1Password</strong>,{' '}
          <strong>Bitwarden</strong>).
        </li>
        <li>Scan de QR-code met die app (of typ de sleutel over).</li>
        <li>Vul de 6 cijfers in die de app toont.</li>
      </ol>

      {!start && (
        <div className="ac-acties">
          <button type="button" className="db-knop db-knop-primair" onClick={begin} disabled={bezig}>
            {bezig ? 'Even geduld…' : 'Start instellen'}
          </button>
          {onAnnuleren && (
            <button type="button" className="db-knop" onClick={onAnnuleren} disabled={bezig}>
              Annuleren
            </button>
          )}
        </div>
      )}

      {start && (
        <form className="bv-scan" onSubmit={bevestig}>
          <div className="bv-qr-vlak">
            {start.qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- SVG-data-URI van Supabase
              <img className="bv-qr" src={start.qr} alt="QR-code voor je authenticator-app" width={176} height={176} />
            ) : (
              <p className="ag-uitleg">Geen QR-code beschikbaar: typ de sleutel hieronder over.</p>
            )}
          </div>
          <div className="bv-scan-rechts">
            <button type="button" className="bv-link" onClick={() => setToonSleutel((x) => !x)} aria-expanded={toonSleutel}>
              {toonSleutel ? 'Sleutel verbergen' : 'Lukt scannen niet? Toon de sleutel'}
            </button>
            {toonSleutel && (
              <p className="bv-sleutel">
                <span className="bv-sleutel-label">Sleutel ({start.naam})</span>
                <code>{sleutelGroepen}</code>
              </p>
            )}
            <label className="ag-label">
              Code uit de app
              <input
                ref={codeRef}
                className="ag-veld bv-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
                required
              />
            </label>
            <div className="ac-acties">
              <button type="submit" className="db-knop db-knop-primair" disabled={bezig || code.replace(/\s/g, '').length !== 6}>
                {bezig ? 'Controleren…' : 'Bevestigen'}
              </button>
              {onAnnuleren && (
                <button type="button" className="db-knop" onClick={onAnnuleren} disabled={bezig}>
                  Annuleren
                </button>
              )}
            </div>
          </div>
        </form>
      )}

      {fout && (
        <p className="ag-fout" role="alert">
          {fout}
        </p>
      )}
    </div>
  );
}
