import type { Metadata } from 'next';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { Binnenkort } from '@/components/shell/Binnenkort';

export const metadata: Metadata = { title: 'Mail · Studio Levant' };

export default function MailPage() {
  return (
    <>
      <ModuleKop label="info@studio-levant.nl" titel="Mail" />
      <Binnenkort
        icoon="mail"
        titel="Je inbox, in de stijl van de backoffice"
        tekst="Hier komt de inbox van Studio Levant (Private Email). Mail lezen en beantwoorden zonder de backoffice te verlaten."
        punten={[
          'Inbox, verzonden, archief en prullenbak',
          'Mails veilig openen — externe afbeeldingen pas na een klik',
          'Beantwoorden, doorsturen en nieuwe mail',
          'Van een mail direct een taak maken'
        ]}
      />
    </>
  );
}
