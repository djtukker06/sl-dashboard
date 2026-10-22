'use client';

import { useEffect, useRef } from 'react';

// Verborgen veld "next" op de loginpagina. De browser stuurt een #hash nooit naar de
// server, maar houdt hem wel vast bij de redirect naar /login. Zo kom je na het inloggen
// terug op exact dezelfde plek (bv. /social#p=<project>).
export function VervolgVeld({ next }: { next?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current && next && location.hash && !next.includes('#')) ref.current.value = next + location.hash;
  }, [next]);
  if (!next) return null;
  return <input ref={ref} type="hidden" name="next" defaultValue={next} />;
}
