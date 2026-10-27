// Voorbeeld-bankafschriften voor de demo (RegioBank- en Revolut-CSV), zodat de import te
// proberen is zonder echt bestand. Verzonnen regels uit de afgelopen week, die passen bij de
// demogegevens: een betaling van een openstaande factuur (en van het restant van een deels
// betaalde), een inkoopfactuur die open staat, bekende leveranciers (voorstel uit de
// geschiedenis), een overboeking tussen de eigen rekeningen en Revolut-regels met kosten, een
// regel in behandeling en een regel in dollars (die worden overgeslagen). Pure module.

import { centenNaarDecimaal } from '../kern/geld';
import { jaarVan, maandVan, plusDagen, type Datum } from '../kern/periode';
import { factuurPosten, uitgavePosten } from '../kern/afletteren';
import type { DemoData } from './demo-seed';

const dmy = (d: Datum) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function voorbeeldAfschriften(data: DemoData, vandaag: Datum): { regiobank: string; revolut: string } {
  const rb = data.stamdata.rekeningen.find((r) => r.importFormaat === 'regiobank');
  const rv = data.stamdata.rekeningen.find((r) => r.importFormaat === 'revolut');
  const eigen = rb?.iban ?? 'NL52RBRB0123456789';
  const fOpen = factuurPosten(data.facturen, data.koppelingen, vandaag).filter((p) => p.open > 0);
  const oud = [...fOpen].sort((a, b) => b.dagen - a.dagen)[0];
  const deels = fOpen.find((p) => p.status === 'deels');
  const inkoop = uitgavePosten(data.uitgaven, data.koppelingen, vandaag).find((p) => p.open > 0 && p.doc.leverancier.includes('Fotografie'));

  type R = { d: Datum; tegen: string; naam: string; bedrag: number; code: string; oms: string; kenmerk?: string };
  const regels: R[] = [];
  if (oud) regels.push({ d: plusDagen(vandaag, -1), tegen: 'NL20INGB0001234567', naam: oud.doc.klant, bedrag: oud.open, code: 'IOB', oms: `Factuur ${oud.doc.nummer}` });
  if (deels && deels !== oud) regels.push({ d: plusDagen(vandaag, -3), tegen: 'NL44RABO0123456789', naam: deels.doc.klant, bedrag: deels.open, code: 'IOB', oms: `Restant factuur ${deels.doc.nummer}` });
  if (inkoop) regels.push({ d: plusDagen(vandaag, -2), tegen: 'NL91ABNA0417164300', naam: inkoop.doc.leverancier, bedrag: -inkoop.open, code: 'OVB', oms: 'Portretten team', kenmerk: '2026-118' });
  regels.push(
    { d: plusDagen(vandaag, -4), tegen: 'NL13KPNB0101010101', naam: 'KPN B.V.', bedrag: -4840, code: 'INC', oms: 'KPN Zakelijk mobiel en internet extra bundel' },
    { d: plusDagen(vandaag, -5), tegen: rv?.iban ?? 'LT123250012345678901', naam: 'Studio Levant (Revolut)', bedrag: -25000, code: 'OVB', oms: 'Overboeking naar Revolut' },
    { d: plusDagen(vandaag, -6), tegen: 'NL86INGB0002445588', naam: 'TransIP B.V.', bedrag: -1815, code: 'INC', oms: 'Webhosting en domeinen' },
    { d: plusDagen(vandaag, -7), tegen: 'NL47ABNA0503333333', naam: 'NS Reizigers', bedrag: -2760, code: 'BEA', oms: 'NS Zakelijk reizen' }
  );
  let saldo = 1_250_000;
  const rbCsv = regels
    .map((r, i) => {
      const voor = saldo;
      saldo += r.bedrag;
      const volg = `${jaarVan(r.d)}${String(maandVan(r.d)).padStart(2, '0')}${String(9100 + i).padStart(6, '0')}`;
      return [dmy(r.d), eigen, r.tegen, r.naam, '', '', '', 'EUR', centenNaarDecimaal(voor), 'EUR', centenNaarDecimaal(r.bedrag), dmy(r.d), dmy(r.d), '1234', r.code, volg, r.kenmerk ?? '', r.oms, '42']
        .map(q)
        .join(',');
    })
    .join('\n');

  const kop = 'Date started (UTC),Date completed (UTC),ID,Type,State,Description,Reference,Payer,Card number,Orig currency,Orig amount,Payment currency,Amount,Fee,Balance,Account,Beneficiary IBAN';
  const t = (d: Datum, uur: string) => `${d} ${uur}`;
  const rvRegels = [
    [t(plusDagen(vandaag, -5), '09:12:01'), t(plusDagen(vandaag, -5), '09:12:04'), 'a1f0c2d4-0000-4000-8000-00000000d001', 'TOPUP', 'COMPLETED', 'Overboeking van RegioBank', '', '', '', 'EUR', '250.00', 'EUR', '250.00', '0.00', '', 'EUR Main', ''],
    [t(plusDagen(vandaag, -3), '14:40:10'), t(plusDagen(vandaag, -2), '08:01:00'), 'a1f0c2d4-0000-4000-8000-00000000d002', 'CARD_PAYMENT', 'COMPLETED', 'Fontstand', 'Fontlicentie', '', '4321********1234', 'EUR', '-14.99', 'EUR', '-14.99', '0.50', '', 'EUR Main', ''],
    [t(plusDagen(vandaag, -2), '17:22:41'), t(plusDagen(vandaag, -1), '06:10:12'), 'a1f0c2d4-0000-4000-8000-00000000d003', 'CARD_PAYMENT', 'COMPLETED', 'Notion Labs', 'Plus plan', '', '4321********1234', 'USD', '-12.00', 'EUR', '-11.04', '0.00', '', 'EUR Main', ''],
    [t(plusDagen(vandaag, -1), '10:05:00'), '', 'a1f0c2d4-0000-4000-8000-00000000d004', 'CARD_PAYMENT', 'PENDING', 'Figma', '', '', '4321********1234', 'EUR', '-30.00', 'EUR', '-30.00', '0.00', '', 'EUR Main', ''],
    [t(plusDagen(vandaag, -1), '12:00:00'), t(plusDagen(vandaag, -1), '12:00:03'), 'a1f0c2d4-0000-4000-8000-00000000d005', 'CARD_PAYMENT', 'COMPLETED', 'Envato', '', '', '4321********1234', 'USD', '-19.00', 'USD', '-19.00', '0.00', '', 'USD Main', '']
  ];
  const rvCsv = [kop, ...rvRegels.map((r) => r.join(','))].join('\n');
  return { regiobank: rbCsv + '\n', revolut: rvCsv + '\n' };
}
