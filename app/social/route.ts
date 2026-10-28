import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { huidigTeamlid, tfaDoel } from '@/lib/auth/team';
import { railHtml } from '@/lib/shell/rail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// De social-module is een statische frontend (originele Levant Social Studio). De
// HTML staat in assets/social-app/index.html (niet in public/, zodat hij nooit zonder
// rail of sessiecheck te zien is); app.js en app.css staan in public/social/.
// Deze route voegt de gedeelde navigatierail van de backoffice toe — de inhoud van de
// social-schermen zelf blijft gelijk aan het origineel.
const HTML_PAD = path.join(process.cwd(), 'assets', 'social-app', 'index.html');
let cache: string | null = null;

async function leesHtml() {
  // In development altijd vers inlezen, zodat wijzigingen direct zichtbaar zijn.
  if (cache && process.env.NODE_ENV === 'production') return cache;
  cache = await readFile(HTML_PAD, 'utf8');
  return cache;
}

export async function GET(request: Request) {
  // Sessie + teamlidmaatschap (lib/auth/team.ts), net als elke pagina in de shell.
  const s = await huidigTeamlid();
  if (s.soort === 'anoniem') {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', '/social');
    return NextResponse.redirect(url);
  }
  if (s.soort === 'geen_toegang') return NextResponse.redirect(new URL('/geen-toegang', request.url));
  if (s.soort === 'tfa') return NextResponse.redirect(new URL(tfaDoel(s, '/social'), request.url));
  if (s.soort === 'wachtwoord') return NextResponse.redirect(new URL('/nieuw-wachtwoord', request.url));
  if (s.soort === 'storing') {
    return new Response('De toegangscontrole is tijdelijk niet beschikbaar. Probeer het zo opnieuw.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const { lid } = s;

  const rail = railHtml('social', {
    id: lid.userId,
    email: lid.email,
    naam: lid.profiel.naam,
    initialen: lid.profiel.initialen,
    kleur: lid.profiel.kleur,
    eigenaar: lid.rol === 'eigenaar'
  });
  // Nonce van de Content-Security-Policy (proxy.ts): de scripts van deze statische HTML
  // krijgen hem expliciet (alleen base64-tekens, dus veilig in een attribuut).
  const nonceKop = request.headers.get('x-nonce') ?? '';
  const nonce = /^[A-Za-z0-9+/=]{16,64}$/.test(nonceKop) ? nonceKop : '';
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  // Functies als vervanging: dan worden $-tekens in bv. een e-mailadres niet als patroon gelezen.
  const html = (await leesHtml())
    .replace(/<script\b(?![^>]*\bnonce=)/g, () => `<script${nonceAttr}`)
    .replace('</head>', () => '<link rel="stylesheet" href="/shell/shell.css">\n</head>')
    .replace(
      '<body>',
      () => `<body class="sl-met-rail">\n${rail}\n<script src="/shell/shell.js" defer${nonceAttr}></script>`
    );

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
