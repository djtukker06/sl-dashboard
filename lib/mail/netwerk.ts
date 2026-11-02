import { isIP } from 'node:net';

// Welke adressen mag de server benaderen bij het koppelen van een mailbox? Alleen
// openbare internetadressen: geen loopback, privé-netwerken, link-local (o.a. cloud-
// metadata op 169.254.169.254), CGNAT, multicast of gereserveerde blokken (SSRF).
// Zonder '@/'-imports, zodat scripts/test-account.mjs dit los kan testen.

const IPV4_GEBLOKT: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

function v4Getal(ip: string): number {
  return ip.split('.').reduce((n, d) => n * 256 + Number(d), 0);
}

function v4Publiek(ip: string): boolean {
  const n = v4Getal(ip);
  return !IPV4_GEBLOKT.some(([net, bits]) => {
    const maskers = bits === 0 ? 0 : 2 ** 32 - 2 ** (32 - bits);
    return (n & maskers) >>> 0 === (v4Getal(net) & maskers) >>> 0;
  });
}

/** Het IPv4-adres in ::ffff:a.b.c.d-, ::a.b.c.d- of 6to4-vorm (in hex), anders null. */
function ingebedIpv4(ip: string): string | null {
  let canoniek: string;
  try {
    canoniek = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const m = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canoniek) || /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/.exec(canoniek);
  if (!m) return null;
  const hoog = parseInt(m[1], 16);
  const laag = parseInt(m[2], 16);
  return `${hoog >> 8}.${hoog & 255}.${laag >> 8}.${laag & 255}`;
}

/** Is dit IP-adres een openbaar internetadres? (v4 en v6) */
export function isPubliekAdres(ip: string): boolean {
  const soort = isIP(ip);
  if (soort === 4) return v4Publiek(ip);
  if (soort !== 6) return false;
  const a = ip.toLowerCase();
  // IPv4 binnen IPv6 (::ffff:10.0.0.1, ::10.0.0.1): de v4-regels.
  const v4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (v4) return v4Publiek(v4[1]);
  // Dezelfde vormen in hex, zoals de URL-parser en DNS ze geven (::ffff:7f00:1, ::7f00:1),
  // en 6to4 (2002:7f00:1::): ook daar gelden de v4-regels voor het ingebedde adres.
  const ingebed = ingebedIpv4(a);
  if (ingebed && !v4Publiek(ingebed)) return false;
  if (a === '::' || a === '::1') return false;
  const eerste = parseInt(a.split(':')[0] || '0', 16);
  if ((eerste & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((eerste & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((eerste & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (a.startsWith('2001:db8:') || a.startsWith('64:ff9b:')) return false; // documentatie / NAT64
  return true;
}

/** Een hostnaam (geen IP-adres, geen poort): mail.voorbeeld.nl */
export function isHostnaam(host: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}
