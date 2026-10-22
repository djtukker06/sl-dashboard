import { ModuleKop } from '@/components/shell/ModuleKop';
import { BoekhoudingTabs } from './BoekhoudingTabs';

// Kop van alle Boekhouding-schermen (overzicht, facturen, bonnetjes): de gewone modulekop
// met label "Boekhouding", eventueel acties rechts, en daaronder de subnavigatie.
export function BoekhoudingKop({ titel, children }: { titel: React.ReactNode; children?: React.ReactNode }) {
  return (
    <>
      <ModuleKop label="Boekhouding" titel={titel}>
        {children}
      </ModuleKop>
      <BoekhoudingTabs />
    </>
  );
}
