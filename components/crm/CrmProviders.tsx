'use client';

import { useRouter } from 'next/navigation';
import { ToastProvider } from '@/components/agenda/Toast';
import { TakenProvider, useTaakGebeurtenis } from '@/components/taken/TakenProvider';

// Client-omhulsel voor de pagina's Klanten & projecten: meldingen, de taak-popup (sneltoets
// n) en na elke taakwijziging de servergegevens opnieuw ophalen (router.refresh). De pagina's
// zelf zijn servercomponenten; alleen de bewerkbare stukjes zijn client-eilanden.
export function CrmProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <TakenProvider>
        <Verversen />
        {children}
      </TakenProvider>
    </ToastProvider>
  );
}

function Verversen() {
  const router = useRouter();
  useTaakGebeurtenis(() => router.refresh());
  return null;
}
