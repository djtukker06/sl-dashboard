import type { Browser } from 'puppeteer-core';
import { chromiumEnv } from '../social/render';

// `puppeteer` (met eigen gedownloade Chrome) is alleen een devDependency, voor lokaal
// ontwikkelen op de Mac. In productie (Vercel) gebruiken we puppeteer-core met de
// serverless-geschikte @sparticuz/chromium-binary. De NODE_ENV-check hieronder is een
// statische build-time constante, dus Next.js sluit de ongebruikte tak uit de bundel.
async function getBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV !== 'production') {
    const puppeteer = await import('puppeteer');
    return puppeteer.launch({ headless: true, env: chromiumEnv() }) as unknown as Promise<Browser>;
  }

  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteerCore = await import('puppeteer-core');
  const executablePath = await chromium.executablePath();
  return puppeteerCore.launch({
    args: chromium.args,
    executablePath,
    headless: true,
    env: chromiumEnv()
  });
}

export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
