'use client';

import { useEffect, useRef, useState } from 'react';
import { isEmoji } from '@/lib/notities/kern';

// Icoon van een notitie kiezen: een rustige set emoji's om snel te herkennen, of er zelf één
// plakken. Leeg = geen icoon.

const EMOJIS = [
  '💡', '🧠', '✨', '🎯', '🚀', '📌', '📝', '✅',
  '🎨', '🖌️', '📐', '🖼️', '📸', '🎬', '📣', '📱',
  '💬', '🤝', '📞', '✉️', '📅', '⏰', '🗂️', '📎',
  '💰', '📈', '🧾', '🏷️', '🔥', '⭐', '❤️', '⚠️',
  '🌱', '🌍', '🏠', '☕', '🎉', '🔒', '❓', '🔍'
];

export function EmojiKiezer({
  waarde,
  onKies,
  uitgeschakeld = false
}: {
  waarde: string | null;
  onKies: (e: string | null) => void;
  uitgeschakeld?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [eigen, setEigen] = useState('');
  const doos = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function buiten(e: PointerEvent) {
      if (doos.current && !doos.current.contains(e.target as Node)) setOpen(false);
    }
    function toets(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', buiten);
    document.addEventListener('keydown', toets);
    return () => {
      document.removeEventListener('pointerdown', buiten);
      document.removeEventListener('keydown', toets);
    };
  }, [open]);

  function kies(e: string | null) {
    onKies(e);
    setOpen(false);
    setEigen('');
  }

  return (
    <div className="sp-emoji" ref={doos}>
      <button
        type="button"
        className={waarde ? 'sp-emoji-knop' : 'sp-meta-knop sp-emoji-leeg'}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={uitgeschakeld}
        onClick={() => setOpen((o) => !o)}
        title={waarde ? 'Icoon wijzigen' : 'Icoon toevoegen'}
      >
        {waarde ?? (
          <>
            <span aria-hidden="true">☺</span> Icoon
          </>
        )}
      </button>
      {open && (
        <div className="sp-pop sp-emoji-pop" role="dialog" aria-label="Icoon kiezen">
          <div className="sp-emoji-raster">
            {EMOJIS.map((e) => (
              <button key={e} type="button" className={`sp-emoji-optie${e === waarde ? ' is-aan' : ''}`} onClick={() => kies(e)} aria-label={`Icoon ${e}`}>
                {e}
              </button>
            ))}
          </div>
          <form
            className="sp-emoji-eigen"
            onSubmit={(ev) => {
              ev.preventDefault();
              const t = eigen.trim();
              if (isEmoji(t)) kies(t);
            }}
          >
            <input
              className="ag-veld"
              value={eigen}
              maxLength={16}
              placeholder="Of plak een emoji…"
              aria-label="Eigen emoji"
              onChange={(ev) => setEigen(ev.target.value)}
            />
            <button type="submit" className="db-knop db-knop-klein" disabled={!isEmoji(eigen.trim())}>
              Kies
            </button>
          </form>
          {waarde && (
            <button type="button" className="ag-link-knop" onClick={() => kies(null)}>
              Icoon weghalen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
