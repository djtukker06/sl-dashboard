import 'server-only';
import { leesSleutel } from '@/lib/mail/kluis-kern';
import { graphVersie } from './kern';

// Server-instellingen van de Meta-koppeling (nooit naar de browser, nooit loggen):
//   META_APP_ID, META_APP_SECRET   de Meta-app (developers.facebook.com, zie README
//                                  "Social media management")
//   META_CONFIG_ID                 optioneel: de configuratie van Facebook Login for Business
//                                  (tokentype "User access token"). Leeg = klassieke scope-lijst.
//   META_GRAPH_VERSION             optioneel: bv. "v26.0". Leeg = de standaard uit kern.ts.
//   SOCIAL_ENCRYPTION_KEY          optioneel: eigen sleutel (32 bytes, base64) voor de page
//                                  tokens. Leeg = MAIL_ENCRYPTION_KEY (zelfde kluis als Drive en
//                                  de mailboxen, met een eigen AAD per account).

export function metaAppId(): string {
  return (process.env.META_APP_ID || '').trim();
}

export function metaAppSecret(): string {
  return (process.env.META_APP_SECRET || '').trim();
}

export function metaConfigId(): string | null {
  const s = (process.env.META_CONFIG_ID || '').trim();
  return /^\d{5,30}$/.test(s) ? s : null;
}

export function versie(): string {
  return graphVersie(process.env.META_GRAPH_VERSION);
}

export function sleutel(): Buffer | null {
  const eigen = process.env.SOCIAL_ENCRYPTION_KEY;
  if (eigen && eigen.trim()) return leesSleutel(eigen);
  return leesSleutel(process.env.MAIL_ENCRYPTION_KEY);
}

/** Namen van ontbrekende env-vars (nooit waarden). */
export function ontbrekendeEnv(): string[] {
  const mist: string[] = [];
  if (!metaAppId()) mist.push('META_APP_ID');
  if (!metaAppSecret()) mist.push('META_APP_SECRET');
  if (!sleutel()) mist.push(process.env.SOCIAL_ENCRYPTION_KEY?.trim() ? 'SOCIAL_ENCRYPTION_KEY (ongeldig)' : 'MAIL_ENCRYPTION_KEY of SOCIAL_ENCRYPTION_KEY');
  return mist;
}

export function ingericht(): boolean {
  return ontbrekendeEnv().length === 0;
}
