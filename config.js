// Vaste bedrijfsgegevens van Studio Levant. Pas dit bestand aan als gegevens wijzigen.
module.exports = {
  bedrijfsnaam: 'Studio Levant',
  eigenaren: 'Daniël Tukker & Bram Huiskes',
  adresregel: 'Brink 21, Almelo',
  postcode: '7603 ED',
  iban: 'NL92 RBRB 8848 5940 69',
  kvkNummer: '95422145',
  btwNummer: 'NL867124374B01',
  email: 'info@studio-levant.nl',
  algemeneVoorwaardenUrl: 'www.studio-levant.nl/algemene-voorwaarden',
  btwPercentage: 21,

  // Startpunt van de factuurnummering: het eerstvolgende nummer moet 26-008 worden.
  // Dit betekent: voor het jaar 2026 is het laatst gebruikte volgnummer 7.
  factuurnummerStart: {
    jaar: 2026,
    laatsteVolgnummer: 7
  }
};
