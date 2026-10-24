import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium en puppeteer-core staan al op Next.js' eigen auto-externalize-lijst,
  // maar we zetten het expliciet zodat het ook zo blijft werken als dat ooit verandert.
  // Mail (imapflow, mailparser, nodemailer) draait als gewone Node-modules: die leveren zelf
  // een CommonJS-build mee (exports.require) en laden ook zonder require(esm).
  // sanitize-html staat hier bewust NIET in: 2.18 is CommonJS maar require't htmlparser2 12,
  // dat alleen nog ESM is. Als external faalt dat op Vercel met ERR_REQUIRE_ESM ("Failed to
  // load external module sanitize-html"); door hem te laten bundelen lost Turbopack de
  // CJS→ESM-import zelf op, onafhankelijk van de Node-versie. Controle:
  // scripts/test-externals.mjs.
  // libheif-js (HEIC → JPEG voor bonnetjes, lib/uitgaven/beeld.ts) is CommonJS zonder
  // ESM-afhankelijkheden en laadt dus gewoon met require(); als external hoeft Turbopack de
  // 2 MB grote wasm-bundel (wasm als base64 in de .js, geen los .wasm-bestand) niet te verwerken.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core', 'imapflow', 'mailparser', 'nodemailer', 'libheif-js'],
  // De output-file-tracer volgt alleen require()/import-statements, niet de losse
  // Chromium-binaire bestanden (.br) die @sparticuz/chromium pas tijdens het draaien
  // dynamisch inleest — die moeten dus expliciet worden meegenomen in de deploy-bundel.
  // Geldt voor alle API-routes (ook PUT/restfactuur/prijsopgaven), niet alleen /api/invoices.
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    // Social-export rendert de logo's mee (gelezen via fs uit assets/social-brand/), plus Chromium.
    '/api/social/**': [
      './assets/social-brand/**/*',
      './node_modules/@sparticuz/chromium/bin/**/*'
    ],
    // De logo's zijn niet publiek: deze route serveert ze pas na een sessiecheck.
    '/social-files/brand/**': ['./assets/social-brand/**/*'],
    // /social leest de social-HTML via fs in en zet de gedeelde rail erin (app/social/route.ts).
    '/social': ['./assets/social-app/index.html']
  },
  // Geen beeldoptimalisatie nodig (geen next/image): zo is /_next/image (bekende lekken in
  // oudere versies, SSRF/DoS-gevoelig) helemaal dicht.
  images: { unoptimized: true },
  // Geen "X-Powered-By: Next.js" (verraadt alleen de versie-familie).
  poweredByHeader: false,
  // Beveiligingskoppen voor elk antwoord (pagina's, API's en bestanden). De
  // Content-Security-Policy (met nonce per verzoek) zet proxy.ts.
  //   - niet in een frame van een ander domein (clickjacking); eigen iframes (social-slides) mogen;
  //   - Referer alleen binnen de eigen site: signed URL's en ?-parameters lekken niet naar buiten;
  //   - geen MIME-sniffing; camera alleen voor de eigen site (bonnetje fotograferen), de rest uit;
  //   - HSTS: twee jaar alleen https (ook subdomeinen);
  //   - COOP: geen venster van een ander domein kan bij dit venster (window.opener);
  //   - CORP: bestanden van de backoffice zijn niet in te sluiten op andere sites (behalve de
  //     openbare logo's in /brand/, die bv. in een mailhandtekening staan).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' }
        ]
      },
      {
        source: '/((?!brand/).*)',
        headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'same-origin' }]
      }
    ];
  },
  // De facturenschermen staan sinds het dashboard onder /facturen. Oude bookmarks
  // blijven werken via deze tijdelijke redirects (de query, bv. ?jaar=, gaat mee).
  async redirects() {
    return [
      // De social-HTML wordt sinds de gedeelde shell door app/social/route.ts geserveerd.
      { source: '/social/index.html', destination: '/social', permanent: false },
      // Oud jaaroverzicht (/?jaar=2025) → facturenoverzicht met hetzelfde jaar.
      { source: '/', has: [{ type: 'query', key: 'jaar' }], destination: '/facturen', permanent: false },
      { source: '/nieuwe-factuur', destination: '/facturen/nieuwe-factuur', permanent: false },
      // /klanten is sinds Klanten & projecten een eigen module (klantpagina /klanten/<id> met
      // een link naar de facturen van die klant); de oude doorverwijzing naar
      // /facturen/klanten/<id> is daarom weg.
      { source: '/prijsopgaven/:path*', destination: '/facturen/prijsopgaven/:path*', permanent: false },
      // Uitgaven is sinds de tab Boekhouding "Bonnetjes & inkoopfacturen" (?uitgave=, ?toevoegen=1
      // en ?tab=btw gaan vanzelf mee).
      { source: '/uitgaven', destination: '/boekhouding/bonnetjes', permanent: false },
      { source: '/uitgaven/:path*', destination: '/boekhouding/bonnetjes', permanent: false }
    ];
  }
};

export default nextConfig;
