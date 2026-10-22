'use client';

import { ToastProvider } from '@/components/agenda/Toast';
import { TakenProvider } from './TakenProvider';

// Meldingen + de taak-popup voor het dashboard (de pagina zelf is een server-component).
export function DashboardTaken({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <TakenProvider>{children}</TakenProvider>
    </ToastProvider>
  );
}
