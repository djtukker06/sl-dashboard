'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Kleine meldingen onderaan het scherm, met optioneel één actie ("Ongedaan maken").

type Toast = { id: number; tekst: string; fout?: boolean; actie?: { label: string; onClick: () => void }; duur: number };
type ToastFn = (tekst: string, opties?: { fout?: boolean; actie?: Toast['actie']; duur?: number }) => void;

const Ctx = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const teller = useRef(0);

  const weg = useCallback((id: number) => setToasts((l) => l.filter((t) => t.id !== id)), []);

  const toon = useCallback<ToastFn>((tekst, opties = {}) => {
    const id = ++teller.current;
    const duur = opties.duur ?? (opties.actie ? 5000 : opties.fout ? 6000 : 3000);
    // Maximaal 3 tegelijk; de nieuwste onderaan.
    setToasts((l) => [...l.slice(-2), { id, tekst, fout: opties.fout, actie: opties.actie, duur }]);
  }, []);

  return (
    <Ctx.Provider value={toon}>
      {children}
      <div className="ag-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} weg={weg} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastItem({ toast, weg }: { toast: Toast; weg: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => weg(toast.id), toast.duur);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duur, weg]);
  const onWeg = () => weg(toast.id);
  return (
    <div className={`ag-toast${toast.fout ? ' ag-toast-fout' : ''}`}>
      <span>{toast.tekst}</span>
      {toast.actie && (
        <button
          type="button"
          className="ag-toast-actie"
          onClick={() => {
            toast.actie!.onClick();
            onWeg();
          }}
        >
          {toast.actie.label}
        </button>
      )}
      <button type="button" className="ag-toast-sluit" aria-label="Melding sluiten" onClick={onWeg}>
        ×
      </button>
    </div>
  );
}
