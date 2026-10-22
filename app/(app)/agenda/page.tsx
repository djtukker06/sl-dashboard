import type { Metadata } from 'next';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Binnenkort } from '@/components/shell/Binnenkort';

export const metadata: Metadata = { title: 'Agenda & taken · Studio Levant' };

export default function AgendaPage() {
  return (
    <>
      <ModuleKop label="Planning" titel="Agenda & taken" />
      <Binnenkort
        icoon="agenda"
        titel="Taken en afspraken in één agenda"
        tekst="Typ een taak zoals je hem zou opschrijven — de datum, tijd en klant worden herkend en de taak staat meteen in je agenda."
        punten={[
          'Snel invoeren: “Offerte sturen @Jansen vrijdag 14:00 !”',
          'Week- en maandweergave',
          'Afvinken vanaf het dashboard',
          'Gekoppeld aan je klanten'
        ]}
      />
    </>
  );
}
