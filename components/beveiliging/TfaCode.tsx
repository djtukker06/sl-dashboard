'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/beveiliging/client';

// De code bij het inloggen (/login/2fa). Na een goede code een volledige paginalading naar
// `vervolg` (de cookies staan dan op aal2).
export function TfaCode({ vervolg, factoren }: { vervolg: string; factoren: { id: string; naam: string }[] }) {
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState(factoren[0]?.id ?? '');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  async function verstuur(e: React.FormEvent) {
    e.preventDefault();
    setFout('');
    setBezig(true);
    try {
      await api('/api/beveiliging/2fa/uitdagen', 'POST', { code, factorId });
      window.location.href = vervolg;
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Controleren mislukt.');
      setCode('');
      setBezig(false);
      ref.current?.focus();
    }
  }

  return (
    <form onSubmit={verstuur}>
      {fout && <div className="foutmelding">{fout}</div>}
      {factoren.length > 1 && (
        <label>
          Apparaat
          <select value={factorId} onChange={(e) => setFactorId(e.target.value)}>
            {factoren.map((f) => (
              <option key={f.id} value={f.id}>
                {f.naam}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Code uit je authenticator-app
        <input
          ref={ref}
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
          required
          autoFocus
        />
      </label>
      <button type="submit" className="btn-primair" disabled={bezig || code.replace(/\s/g, '').length !== 6}>
        {bezig ? 'Controleren…' : 'Inloggen'}
      </button>
    </form>
  );
}
