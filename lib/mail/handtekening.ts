// Mailhandtekeningen van Studio Levant: één vast sjabloon (logo, naam, functie, contact,
// socials) met een profiel per persoon. Zoals bij Gmail/Outlook kies je in het opstelscherm
// welke handtekening onder de mail komt; standaard die van de inbox waarvandaan je verstuurt
// (bram@ → Bram), bij een gedeelde inbox (info@) die van wie er ingelogd is. "Met vriendelijke
// groet," staat er altijd boven.
//
// Dit bestand draait op de client (voorbeeld in het opstelscherm) én op de server (het
// verzonden bericht). De HTML is mailveilig: tabellen, inline stijlen, PNG's (geen SVG, geen
// webfonts), absolute afbeeldings-URL's uit /brand/ (zie next.config.ts: daar geen CORP-kop).

export interface Handtekening {
  id: string;
  naam: string;
  functie: string;
  /** Zoals getoond, bv. "+31 6 2425 8773". */
  telefoon: string;
  email: string;
}

export const HANDTEKENINGEN: Handtekening[] = [
  { id: 'bram', naam: 'Bram Huiskes', functie: 'Eigenaar', telefoon: '+31 6 2425 8773', email: 'bram@studio-levant.nl' },
  { id: 'daniel', naam: 'Daniël Tukker', functie: 'Eigenaar', telefoon: '+31 6 2521 9263', email: 'daniel@studio-levant.nl' }
];

export const AFSLUITING = 'Met vriendelijke groet,';

const WEBSITE = 'www.studio-levant.nl';

/** Leeg = icoon niet tonen. */
const SOCIALS: { naam: string; url: string; icoon: string }[] = [
  { naam: 'Facebook', url: '', icoon: 'handtekening-facebook.png' },
  { naam: 'LinkedIn', url: 'https://www.linkedin.com/company/studio-levant/', icoon: 'handtekening-linkedin.png' },
  { naam: 'Instagram', url: 'https://www.instagram.com/studiolevant_nl/', icoon: 'handtekening-instagram.png' }
];

/** Keuze in het opstelscherm: een sjabloon-id, 'inbox' (de eigen tekst van de inbox) of '' (geen). */
export type HandtekeningKeuze = string;
export const INBOX_TEKST = 'inbox';

export function zoekHandtekening(id: string | null | undefined): Handtekening | null {
  return HANDTEKENINGEN.find((h) => h.id === id) ?? null;
}

/** Standaard voor een inbox: die van het adres zelf, anders de eigen inboxtekst, anders die van jou. */
export function standaardKeuze(inbox: { email: string; handtekening: string } | undefined, mijnEmail: string): HandtekeningKeuze {
  const bij = (adres: string | undefined) => HANDTEKENINGEN.find((h) => h.email.toLowerCase() === adres?.toLowerCase());
  return bij(inbox?.email)?.id ?? (inbox?.handtekening ? INBOX_TEKST : bij(mijnEmail)?.id ?? HANDTEKENINGEN[0].id);
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const FONT = "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif";
const GRIJS = '#8a8f98';
const DONKER = '#1f1f1f';

/** De kaart (zonder afsluiting). `basis` = origin voor de afbeeldingen ('' = relatief, voor het voorbeeld). */
export function handtekeningKaart(h: Handtekening, basis: string): string {
  const beeld = (bestand: string) => `${basis}/brand/${bestand}`;
  const link = (href: string, tekst: string) =>
    `<a href="${esc(href)}" style="color:${DONKER};text-decoration:none">${esc(tekst)}</a>`;
  const regel = (label: string, waarde: string) =>
    `<tr><td align="center" style="${FONT};font-size:14px;line-height:22px;color:${GRIJS}">${label}: <span style="color:${DONKER}">${waarde}</span></td></tr>`;
  const socials = SOCIALS.filter((s) => s.url)
    .map(
      (s) =>
        `<td style="padding:0 9px"><a href="${esc(s.url)}" style="text-decoration:none"><img src="${esc(beeld(s.icoon))}" width="18" height="18" alt="${s.naam}" style="display:block;border:0;width:18px;height:18px"></a></td>`
    )
    .join('');

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="280" style="width:280px;border-collapse:separate;background:#ffffff;border:1px solid #ececec;border-radius:12px">` +
    `<tr><td align="center" style="padding:26px 20px 18px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">` +
    `<tr><td align="center" style="padding-bottom:16px"><a href="https://${WEBSITE}" style="text-decoration:none"><img src="${esc(beeld('handtekening-logo.png'))}" width="180" height="25" alt="Studio Levant" style="display:block;border:0;width:180px;height:25px"></a></td></tr>` +
    `<tr><td align="center" style="${FONT};font-size:16px;line-height:22px;color:${DONKER}">${esc(h.naam)}</td></tr>` +
    `<tr><td align="center" style="${FONT};font-size:14px;line-height:22px;color:${GRIJS};padding-bottom:2px">${esc(h.functie)}</td></tr>` +
    regel('Telefoon', link(`tel:${h.telefoon.replace(/[^\d+]/g, '')}`, h.telefoon)) +
    regel('Email', link(`mailto:${h.email}`, h.email)) +
    regel('Website', link(`https://${WEBSITE}`, WEBSITE)) +
    `</table></td></tr>` +
    (socials
      ? `<tr><td style="border-top:1px solid #ececec;padding:14px 20px 16px" align="center">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${socials}</tr></table></td></tr>`
      : '') +
    `</table>`
  );
}

/** Afsluiting + kaart, of de eigen inboxtekst; '' bij geen handtekening. */
export function handtekeningHtml(keuze: HandtekeningKeuze, inboxTekst: string, basis: string): string {
  const h = zoekHandtekening(keuze);
  if (h) {
    return (
      `<div style="${FONT};font-size:14px;line-height:22px;color:${DONKER};margin:0 0 14px">${esc(AFSLUITING)}</div>` +
      handtekeningKaart(h, basis)
    );
  }
  if (keuze === INBOX_TEKST && inboxTekst) {
    return `<div style="${FONT};font-size:14px;line-height:22px;color:${DONKER}">${esc(inboxTekst).replace(/\n/g, '<br>')}</div>`;
  }
  return '';
}

/** Dezelfde handtekening als platte tekst (text/plain-deel van de mail). */
export function handtekeningTekst(keuze: HandtekeningKeuze, inboxTekst: string): string {
  const h = zoekHandtekening(keuze);
  if (h) {
    return [
      AFSLUITING,
      '',
      h.naam,
      `${h.functie} · Studio Levant`,
      `Telefoon: ${h.telefoon}`,
      `Email: ${h.email}`,
      `Website: ${WEBSITE}`
    ].join('\n');
  }
  return keuze === INBOX_TEKST ? inboxTekst : '';
}

// ---------- het hele bericht (server) ----------

/** Origineel onder een antwoord of doorgestuurd bericht: kop ("Op … schreef …:") en de tekst. */
export interface Citaat {
  kop: string;
  tekst: string;
  /** Antwoord = "> "-citaat / blockquote; doorsturen = gewoon eronder. */
  antwoord: boolean;
}

function citeer(tekst: string) {
  return tekst
    .split('\n')
    .map((r) => (r.startsWith('>') ? `>${r}` : `> ${r}`))
    .join('\n');
}

/** Platte tekst → HTML: escapen, links klikbaar, regels behouden. */
function tekstNaarHtml(tekst: string): string {
  return esc(tekst)
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" style="color:#2457c5">${u}</a>`)
    .replace(/\n/g, '<br>');
}

export function bouwInhoud(
  tekst: string,
  keuze: HandtekeningKeuze,
  inboxTekst: string,
  citaat: Citaat | null,
  basis: string
): { text: string; html: string } {
  const body = tekst.replace(/\s+$/, '');
  const handTekst = handtekeningTekst(keuze, inboxTekst);
  const handHtml = handtekeningHtml(keuze, inboxTekst, basis);

  const text = [
    body,
    handTekst,
    citaat ? `${citaat.kop}\n${citaat.antwoord ? citeer(citaat.tekst) : citaat.tekst}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  const blokken: string[] = [];
  if (body) blokken.push(`<div style="${FONT};font-size:14px;line-height:22px;color:${DONKER}">${tekstNaarHtml(body)}</div>`);
  if (handHtml) blokken.push(`<div style="margin-top:${body ? 22 : 0}px">${handHtml}</div>`);
  if (citaat) {
    const kop = `<div style="${FONT};font-size:13px;line-height:20px;color:#555">${tekstNaarHtml(citaat.kop)}</div>`;
    const inhoud = `<div style="${FONT};font-size:13px;line-height:20px;color:#555">${tekstNaarHtml(citaat.tekst)}</div>`;
    blokken.push(
      `<div style="margin-top:26px">${kop}` +
        (citaat.antwoord
          ? `<blockquote style="margin:8px 0 0 4px;padding-left:12px;border-left:2px solid #d8d4d1">${inhoud}</blockquote>`
          : `<div style="margin-top:10px">${inhoud}</div>`) +
        `</div>`
    );
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0">${blokken.join('')}</body></html>`;
  return { text, html };
}
