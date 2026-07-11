import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @sparticuz/chromium en puppeteer-core staan al op Next.js' eigen auto-externalize-lijst,
  // maar we zetten het expliciet zodat het ook zo blijft werken als dat ooit verandert.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // De output-file-tracer volgt alleen require()/import-statements, niet de losse
  // Chromium-binaire bestanden (.br) die @sparticuz/chromium pas tijdens het draaien
  // dynamisch inleest — die moeten dus expliciet worden meegenomen in de deploy-bundel.
  outputFileTracingIncludes: {
    '/api/invoices': ['./node_modules/@sparticuz/chromium/bin/**/*']
  }
};

export default nextConfig;
