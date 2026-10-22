import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium en puppeteer-core staan al op Next.js' eigen auto-externalize-lijst,
  // maar we zetten het expliciet zodat het ook zo blijft werken als dat ooit verandert.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
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
    '/social-files/brand/**': ['./assets/social-brand/**/*']
  },
  // De social-module is een statische frontend (public/social/index.html, app.js, app.css).
  // /social toont die pagina. Rewrites in een array worden ná de public-bestanden en vóór
  // dynamische routes toegepast; de proxy (proxy.ts) draait daarvóór en stuurt niet-ingelogde
  // bezoekers dus altijd eerst naar /login.
  async rewrites() {
    return [{ source: '/social', destination: '/social/index.html' }];
  },
  // De facturenschermen staan sinds het dashboard onder /facturen. Oude bookmarks
  // blijven werken via deze tijdelijke redirects (de query, bv. ?jaar=, gaat mee).
  async redirects() {
    return [
      // Oud jaaroverzicht (/?jaar=2025) → facturenoverzicht met hetzelfde jaar.
      { source: '/', has: [{ type: 'query', key: 'jaar' }], destination: '/facturen', permanent: false },
      { source: '/nieuwe-factuur', destination: '/facturen/nieuwe-factuur', permanent: false },
      { source: '/klanten/:path*', destination: '/facturen/klanten/:path*', permanent: false },
      { source: '/prijsopgaven/:path*', destination: '/facturen/prijsopgaven/:path*', permanent: false }
    ];
  }
};

export default nextConfig;
