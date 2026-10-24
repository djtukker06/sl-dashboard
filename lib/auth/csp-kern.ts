// Content-Security-Policy van de backoffice (gezet door proxy.ts, met een nonce per verzoek).
// Zonder imports met @/, zodat scripts/test-beveiliging.mjs en de rooktest hem kunnen laden.
//
// - script-src: alleen eigen bestanden en scripts met de nonce van dit verzoek (Next.js zet
//   de nonce zelf op zijn scripts; de shell en /social krijgen hem expliciet). Bewust ZONDER
//   'strict-dynamic': dan blijven gewone <script src="/..."> van de eigen site (shell.js,
//   social/app.js) werken, en een ingevoegd inline-script of een script van een ander domein
//   niet. Geen 'unsafe-inline' en (behalve in development) geen 'unsafe-eval'.
// - style-src 'unsafe-inline': React-stijlattributen en de social-HTML gebruiken inline
//   stijlen; CSS kan geen scripts starten. Google Fonts (Manrope) mag.
// - connect-src: de eigen API en Supabase (uploads via signed URL's gaan rechtstreeks naar
//   Supabase Storage).
// - frame-src: eigen iframes (PDF-voorbeelden, social-slides), blob: en Supabase (signed URL
//   van een bonnetje-PDF). frame-ancestors 'self': nooit in een frame van een ander domein.

export function supabaseOrigins(url: string | undefined): { https: string; wss: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { https: u.origin, wss: `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}` };
  } catch {
    return null;
  }
}

export function bouwCsp(o: { nonce: string; supabaseUrl?: string; dev?: boolean }): string {
  const sb = supabaseOrigins(o.supabaseUrl);
  const sbHttps = sb ? ` ${sb.https}` : '';
  const delen = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${o.nonce}'${o.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self'${sbHttps}${sb ? ` ${sb.wss}` : ''}${o.dev ? ' ws: wss:' : ''}`,
    "media-src 'self' blob:",
    `frame-src 'self' blob: data:${sbHttps}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "manifest-src 'self'"
  ];
  if (!o.dev) delen.push('upgrade-insecure-requests');
  return delen.join('; ');
}

/** Een nonce: 16 willekeurige bytes, base64. */
export function maakNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
