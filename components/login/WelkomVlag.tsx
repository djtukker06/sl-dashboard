'use client';

import { useEffect, useRef } from 'react';
import { markeerWelkom } from '@/lib/shell/welkom';

// In het inlogformulier: bij versturen de welkomstanimatie klaarzetten (lib/shell/welkom.ts).
// Lukt inloggen niet, dan komt niemand in de app en verloopt de markering vanzelf.
export function WelkomVlag() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    form.addEventListener('submit', markeerWelkom);
    return () => form.removeEventListener('submit', markeerWelkom);
  }, []);
  return <span ref={ref} hidden />;
}
