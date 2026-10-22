// Een teamlid zoals de schermen het tonen (avatar, naam). Geen e-mailadressen of rechten:
// dit gaat als context naar de browser.
export interface TeamProfiel {
  id: string;
  naam: string;
  voornaam: string;
  initialen: string;
  kleur: string;
  actief: boolean;
}
