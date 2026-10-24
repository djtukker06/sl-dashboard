import 'server-only';
import { lookup } from 'node:dns/promises';
import { MailFout } from './fout';
import { isHostnaam, isPubliekAdres } from './netwerk';

// Elke verbinding met een mailserver gaat via een GECONTROLEERD openbaar IP-adres, met de
// hostnaam alleen voor TLS/SNI en de certificaatcontrole. Zo kan een mailserver die bij het
// koppelen openbaar was, later niet via DNS naar een intern adres wijzen (DNS-rebinding /
// SSRF) — belangrijk nu inboxen met het hele team gedeeld kunnen worden.

const CACHE_MS = 60_000;
const cache = new Map<string, { tot: number; ip: string }>();

/** Het (eerste) openbare IP-adres van een mailserver; gooit bij een intern of onbekend adres. */
export async function openbaarAdres(host: string): Promise<string> {
  const sleutel = host.trim().toLowerCase();
  const hit = cache.get(sleutel);
  if (hit && hit.tot > Date.now()) return hit.ip;
  if (!isHostnaam(sleutel)) throw new MailFout(400, 'ongeldig', `Ongeldige servernaam: ${host.slice(0, 80)}`);
  let adressen: { address: string }[];
  try {
    adressen = await lookup(sleutel, { all: true, verbatim: true });
  } catch {
    throw new MailFout(504, 'onbereikbaar', `De server ${sleutel.slice(0, 80)} is niet gevonden. Controleer de naam.`);
  }
  if (!adressen.length || adressen.some((a) => !isPubliekAdres(a.address))) {
    throw new MailFout(400, 'ongeldig', `De server ${sleutel.slice(0, 80)} wijst naar een intern adres en is niet toegestaan.`);
  }
  if (cache.size > 200) cache.clear();
  cache.set(sleutel, { tot: Date.now() + CACHE_MS, ip: adressen[0].address });
  return adressen[0].address;
}
