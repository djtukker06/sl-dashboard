// Minimale omgeving voor de headless Chromium van de PDF's (lib/invoice/pdf.ts).
// Standaard geeft puppeteer de browser alle variabelen van de server mee, dus ook de
// service-role-key en de versleutelingssleutels; de browser rendert HTML met gegevens van
// klanten, dus hij krijgt alleen wat hij nodig heeft om te starten. Pas aanroepen NA
// `chromium.executablePath()`: @sparticuz/chromium zet daar zelf HOME, FONTCONFIG_PATH en
// LD_LIBRARY_PATH.
const CHROMIUM_ENV = ['PATH', 'HOME', 'TMPDIR', 'TZ', 'LANG', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE'];

export function chromiumEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const naam of CHROMIUM_ENV) {
    const waarde = process.env[naam];
    if (waarde !== undefined) env[naam] = waarde;
  }
  return env;
}
