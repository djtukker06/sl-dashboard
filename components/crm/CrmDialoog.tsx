'use client';

import { useEffect, useRef } from 'react';

// Kleine popup in dezelfde stijl als de taak-popup (tk-laag/tk-dialoog uit taken.css).
// Escape of een klik naast de popup sluit hem; de focus blijft in de popup.
export function CrmDialoog({
  titel,
  onSluit,
  children
}: {
  titel: string;
  onSluit: () => void;
  children: React.ReactNode;
}) {
  const doos = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vorige = document.activeElement as HTMLElement | null;
    const eerste = doos.current?.querySelector<HTMLElement>('input, select, textarea, button');
    eerste?.focus();
    return () => vorige?.focus?.();
  }, []);

  function toets(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSluit();
      return;
    }
    if (e.key !== 'Tab' || !doos.current) return;
    const items = [...doos.current.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href]')].filter((x) => !x.hasAttribute('disabled'));
    if (!items.length) return;
    const eerste = items[0];
    const laatste = items[items.length - 1];
    if (e.shiftKey && document.activeElement === eerste) {
      e.preventDefault();
      laatste.focus();
    } else if (!e.shiftKey && document.activeElement === laatste) {
      e.preventDefault();
      eerste.focus();
    }
  }

  return (
    <div className="tk-laag" onKeyDown={toets}>
      <div className="tk-achter" aria-hidden="true" onClick={onSluit} />
      <div ref={doos} className="tk-dialoog kp-dialoog" role="dialog" aria-modal="true" aria-label={titel}>
        <div className="tk-kop">
          <h2 className="tk-kop-titel">{titel}</h2>
          <button type="button" className="ag-icoonknop" aria-label="Sluiten" onClick={onSluit}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="tk-inhoud">{children}</div>
      </div>
    </div>
  );
}

/** POST/PATCH/DELETE naar de eigen API; gooit een Error met de nette melding. */
export async function crmApi<T>(url: string, methode: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: methode,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    });
  } catch {
    throw new Error('Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('Je bent uitgelogd.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Er ging iets mis. Probeer het opnieuw.');
  return data as T;
}
