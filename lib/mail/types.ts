// Vormen die de mail-API teruggeeft en die de client (/mail, dashboard, shell) gebruikt.
import type { InboxDto } from './zichtbaarheid';
export type { InboxDto } from './zichtbaarheid';

/** Rol van een map; 'overig' = gewone (eigen) map. */
export type MapRol = 'inbox' | 'verzonden' | 'concepten' | 'archief' | 'spam' | 'prullenbak' | 'overig';

export interface MailMap {
  /** Volledig IMAP-pad (bv. "INBOX", "Sent", "INBOX.Klanten"). Dient als id. */
  pad: string;
  /** Weergavenaam (Nederlands voor speciale mappen). */
  naam: string;
  rol: MapRol;
  ongelezen: number;
  totaal: number;
  /** Diepte in de mappenboom (0 = hoofdniveau), voor inspringen. */
  niveau: number;
}

export interface Adres {
  naam: string;
  adres: string;
}

/** Eén regel in de berichtenlijst. */
export interface Envelop {
  uid: number;
  van: Adres | null;
  aan: Adres[];
  onderwerp: string;
  /** ISO-moment. */
  datum: string | null;
  gelezen: boolean;
  gemarkeerd: boolean;
  beantwoord: boolean;
  heeftBijlagen: boolean;
  /** Id van de inbox waar dit bericht in staat (meerdere inboxen). */
  mb?: string;
}

export interface BerichtenPagina {
  map: string;
  pagina: number;
  per: number;
  /** Aantal berichten in de map (of zoekresultaten). */
  totaal: number;
  berichten: Envelop[];
  meer: boolean;
  /** Bij "Alle inboxen": inboxen die nu niet bereikbaar waren. */
  fouten?: { id: string; label: string }[];
}

export interface Bijlage {
  /** IMAP-deelnummer, bv. "2" of "1.2" — gebruikt in de download-URL. */
  deel: string;
  naam: string;
  type: string;
  /** Bytes (schatting van de server; base64-overhead is er al af). */
  grootte: number;
}

export interface Bericht {
  map: string;
  uid: number;
  messageId: string | null;
  van: Adres | null;
  antwoordAan: Adres[];
  aan: Adres[];
  cc: Adres[];
  onderwerp: string;
  datum: string | null;
  gelezen: boolean;
  gemarkeerd: boolean;
  /** Gesaneerde HTML (alleen voor de gesandboxte iframe), of null bij een tekstmail. */
  html: string | null;
  /** Platte tekst (altijd gevuld als die er is; bij HTML-mails een tekstversie). */
  tekst: string;
  bijlagen: Bijlage[];
  /** Aantal geblokkeerde externe afbeeldingen in de HTML. */
  externeBeelden: number;
  /** true als het bericht te groot was om volledig te tonen. */
  ingekort: boolean;
}

/** Ongelezen in de inbox van één gekoppelde mailbox (of waarom dat niet lukte). */
export interface InboxTeller {
  id: string;
  ongelezen: number;
  /** Nederlandse melding als deze inbox nu niet bereikbaar is. */
  fout?: string;
}

/** Een inbox met teller (GET /api/mail/inboxen). Nooit wachtwoord of servers. */
export type InboxMetTeller = InboxDto & InboxTeller;

export interface MailStatus {
  geconfigureerd: boolean;
  /** Som over alle zichtbare inboxen. */
  ongelezen: number;
  perInbox?: InboxTeller[];
}

export interface MailOverzicht {
  geconfigureerd: boolean;
  ongelezen: number;
  /** De laatste berichten over alle inboxen (elk met `mb`). */
  berichten: Envelop[];
  /** Naam en kleur per inbox, voor de chip bij elk bericht. */
  inboxen?: Pick<InboxDto, 'id' | 'label' | 'email' | 'kleur'>[];
  /** Inboxen die nu niet bereikbaar waren. */
  fouten?: { id: string; label: string }[];
  /** Per bereikbare inbox: zijn ongelezen en zijn eigen laatste berichten (de keuze in de widget). */
  perInbox?: Record<string, { ongelezen: number; berichten: Envelop[] }>;
}

/** Wat de API stuurt bij een fout. */
export interface MailApiFout {
  error: string;
  code?: MailFoutCode;
}

export type MailFoutCode =
  | 'niet_gekoppeld'
  | 'inloggen_mislukt'
  | 'onbereikbaar'
  | 'niet_gevonden'
  | 'ongeldig'
  | 'te_groot'
  | 'opslag_ontbreekt'
  | 'verzenden_mislukt'
  | 'niet_ingelogd'
  | 'provider_onbekend'
  | 'provider_microsoft'
  | 'te_vaak'
  | 'mailbox_onbekend';

/** De env-vars van de mailkoppeling, voor de uitleg op de "nog niet gekoppeld"-schermen. */
export const MAIL_ENV_VARS: { naam: string; uitleg: string; verplicht: boolean }[] = [
  { naam: 'MAIL_USER', uitleg: 'het mailadres, bv. info@studio-levant.nl', verplicht: true },
  { naam: 'MAIL_PASSWORD', uitleg: 'het wachtwoord van die mailbox', verplicht: true },
  { naam: 'MAIL_IMAP_HOST', uitleg: 'mail.privateemail.com (poort MAIL_IMAP_PORT=993)', verplicht: false },
  { naam: 'MAIL_SMTP_HOST', uitleg: 'mail.privateemail.com (poort MAIL_SMTP_PORT=465)', verplicht: false },
  { naam: 'MAIL_FROM_NAME', uitleg: 'afzendernaam, bv. Studio Levant', verplicht: false },
  { naam: 'MAIL_HANDTEKENING', uitleg: 'handtekening onder nieuwe mails (\\n = nieuwe regel)', verplicht: false },
  {
    naam: 'MAIL_ENV_USER_ID',
    uitleg: 'user-id van het account dat deze mailbox krijgt (standaard: wie hetzelfde adres heeft, anders de oudste eigenaar)',
    verplicht: false
  }
];
