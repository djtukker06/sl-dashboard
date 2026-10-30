import { after } from 'next/server';
import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import type { MailConfig } from './config';
import { MailFout, naarMailFout, NIET_GEKOPPELD } from './fout';
import { openbaarAdres } from './dns';
import { logFout } from '@/lib/log';

// IMAP-verbindingen, warm gehouden per serverinstantie. Inloggen bij de mailserver (TLS +
// LOGIN, server in de VS) kost ±1,8 s; elk commando daarna ±0,15 s. Daarom blijft een
// ingelogde verbinding per mailbox even open en hergebruiken volgende verzoeken (ook
// gelijktijdige: één login voor tellers, mappen en lijst samen) hem. Betrouwbaar:
//   - vóór hergebruik een NOOP (max. 2,5 s): bewijst dat de verbinding leeft én haalt nieuwe
//     mail/verwijderingen binnen, zodat EXISTS en vlaggen nooit verouderd zijn. Faalt die,
//     dan gewoon opnieuw inloggen (vóór het eigenlijke werk, dus nooit iets dubbel gedaan);
//   - sleutel = server + gebruiker + hash van het wachtwoord: een gewijzigd of ander account
//     krijgt nooit een bestaande verbinding. Wie bij welke inbox mag, controleert de route
//     daarvóór (lib/mail/api.ts) — de pool zelf geeft geen toegang;
//   - hooguit twee verbindingen per mailbox: bij een koude start loggen twee verzoeken tegelijk
//     in (dan lopen hun commando's parallel); is er al een warme, dan altijd die (de minst
//     drukke) — nooit opnieuw inloggen alleen omdat hij even bezig is;
//   - na 4 minuten stilte uitloggen, na 10 minuten altijd vervangen; max. 20 verbindingen.
// Buiten een verzoek (scripts) geen pool: openen, werk doen, meteen uitloggen.

const STIL_MS = 4 * 60_000;
const LEEFTIJD_MS = 10 * 60_000;
/** Zo kort geleden bevestigd (login/NOOP/werk): geen extra NOOP nodig. */
const VERS_MS = 1_500;
const NOOP_MS = 2_500;
const MAX_POOL = 20;
const MAX_PER_MAILBOX = 2;

interface Verbinding {
  client: ImapFlow;
  sleutel: string;
  sinds: number;
  bevestigd: number;
  actief: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Uit de pool gehaald terwijl nog in gebruik: de laatste gebruiker meldt af. */
  weg: boolean;
}

const pool = new Map<string, Verbinding[]>();
/** Logins die nu lopen, per mailbox. */
const logins = new Map<string, Promise<Verbinding>[]>();

const aantalInPool = () => [...pool.values()].reduce((n, l) => n + l.length, 0);

function uitPool(v: Verbinding) {
  const lijst = pool.get(v.sleutel);
  if (!lijst) return;
  const rest = lijst.filter((x) => x !== v);
  if (rest.length) pool.set(v.sleutel, rest);
  else pool.delete(v.sleutel);
}

function sleutelVan(cfg: MailConfig): string {
  const ww = createHash('sha256').update(cfg.password).digest('hex');
  return `${cfg.imapHost.toLowerCase()}|${cfg.imapPort}|${cfg.user.toLowerCase()}|${ww}`;
}

async function nieuweClient(cfg: MailConfig): Promise<ImapFlow> {
  // Via het gecontroleerde openbare IP (geen DNS-rebinding naar interne adressen), met de
  // hostnaam voor TLS/SNI en de certificaatcontrole.
  const ip = await openbaarAdres(cfg.imapHost);

  const client = new ImapFlow({
    host: ip,
    servername: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapPort === 993,
    // Poort 143: STARTTLS verplicht, zodat het wachtwoord nooit onversleuteld over de lijn gaat.
    ...(cfg.imapPort === 993 ? {} : { doSTARTTLS: true }),
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 20_000,
    clientInfo: { name: 'Studio Levant backoffice' }
  });
  // Zonder listener zou een socketfout na afloop als "unhandled error" het proces raken.
  client.on('error', (err: unknown) => {
    logFout('[mail] imap', err);
  });

  try {
    await client.connect();
  } catch (e) {
    logFout('[mail] verbinden mislukt', e);
    throw naarMailFout(e);
  }
  return client;
}

function afmelden(client: ImapFlow) {
  if (!client.usable) {
    client.close();
    return;
  }
  client.logout().catch(() => client.close());
}

function laatGaan(v: Verbinding) {
  uitPool(v);
  if (v.timer) clearTimeout(v.timer);
  v.timer = null;
  v.weg = true;
  // Nog in gebruik door een ander verzoek: dat meldt af als het klaar is.
  if (v.actief === 0) afmelden(v.client);
}

function zetStilTimer(v: Verbinding) {
  if (v.timer) clearTimeout(v.timer);
  v.timer = setTimeout(() => {
    if (v.actief === 0) laatGaan(v);
  }, STIL_MS);
  // De timer houdt het proces niet in leven.
  v.timer.unref?.();
}

async function leeft(v: Verbinding): Promise<boolean> {
  if (!v.client.usable) return false;
  const nu = Date.now();
  if (v.weg || nu - v.sinds > LEEFTIJD_MS || nu - v.bevestigd > STIL_MS) return false;
  if (nu - v.bevestigd < VERS_MS) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      v.client.noop(),
      new Promise((_, weiger) => {
        timer = setTimeout(() => weiger(new Error('noop-timeout')), NOOP_MS);
      })
    ]);
    v.bevestigd = Date.now();
    return v.client.usable;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function verbind(cfg: MailConfig, sleutel: string): Promise<Verbinding> {
  const client = await nieuweClient(cfg);
  const v: Verbinding = { client, sleutel, sinds: Date.now(), bevestigd: Date.now(), actief: 0, timer: null, weg: false };
  client.on('close', () => {
    uitPool(v);
    if (v.timer) clearTimeout(v.timer);
  });
  if (aantalInPool() >= MAX_POOL) {
    const oudste = [...pool.values()].flat().filter((x) => x.actief === 0).sort((a, b) => a.bevestigd - b.bevestigd)[0];
    if (oudste) laatGaan(oudste);
  }
  pool.set(sleutel, [...(pool.get(sleutel) ?? []), v]);
  return v;
}

/** Een nieuwe login; telt mee bij de lopende logins van deze mailbox. */
function startLogin(cfg: MailConfig, sleutel: string): Promise<Verbinding> {
  const belofte = verbind(cfg, sleutel);
  logins.set(sleutel, [...(logins.get(sleutel) ?? []), belofte]);
  const klaar = () => {
    const rest = (logins.get(sleutel) ?? []).filter((x) => x !== belofte);
    if (rest.length) logins.set(sleutel, rest);
    else logins.delete(sleutel);
  };
  belofte.then(klaar, klaar);
  return belofte;
}

async function pak(cfg: MailConfig): Promise<Verbinding> {
  const sleutel = sleutelVan(cfg);
  // Eerst een warme verbinding (de minst drukke), mits hij nog leeft.
  for (const v of [...(pool.get(sleutel) ?? [])].sort((a, b) => a.actief - b.actief)) {
    v.actief++;
    if (await leeft(v)) return v;
    v.actief--;
    laatGaan(v);
  }
  // Geen warme: meeliften op een lopende login, of (koude start, nog ruimte) zelf inloggen.
  const lopend = logins.get(sleutel) ?? [];
  const vol = lopend.length > 0 && (pool.get(sleutel)?.length ?? 0) + lopend.length >= MAX_PER_MAILBOX;
  const v = vol ? await lopend[lopend.length - 1] : await startLogin(cfg, sleutel);
  v.actief++;
  return v;
}

function binnenVerzoek(): boolean {
  try {
    after(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function metImap<T>(cfg: MailConfig | null, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (!cfg) throw new MailFout(503, 'niet_gekoppeld', NIET_GEKOPPELD);

  if (!binnenVerzoek()) {
    const client = await nieuweClient(cfg);
    try {
      return await fn(client);
    } catch (e) {
      if (!(e instanceof MailFout)) logFout('[mail] imap-opdracht mislukt', e);
      throw naarMailFout(e);
    } finally {
      afmelden(client);
    }
  }

  const v = await pak(cfg);
  try {
    const uit = await fn(v.client);
    v.bevestigd = Date.now();
    return uit;
  } catch (e) {
    if (!(e instanceof MailFout)) logFout('[mail] imap-opdracht mislukt', e);
    throw naarMailFout(e);
  } finally {
    v.actief--;
    // Een verbinding die tijdens het werk stukging, niet teruggeven.
    if (!v.client.usable || v.weg) laatGaan(v);
    else if (v.actief === 0) zetStilTimer(v);
  }
}
