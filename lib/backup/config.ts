import 'server-only';
import { leesBackupSleutel, sleutelIdVan } from './formaat-kern';
import { ontbrekendeEnv as driveOntbreekt } from '@/lib/drive/config';
import { geldigSecret } from '@/lib/auth/cron-kern';

// Server-instellingen van de back-ups en de keep-alive (nooit naar de browser):
//   BACKUP_ENCRYPTION_KEY  32 bytes, base64 (openssl rand -base64 32). Versleutelt elke
//                          back-up (AES-256-GCM). Bewaar hem OOK in je wachtwoordmanager:
//                          zonder deze sleutel zijn de back-ups onbruikbaar.
//   CRON_SECRET            geheim voor /api/cron/* (Vercel Cron stuurt hem zelf mee als
//                          "Authorization: Bearer …"; GitHub Actions via SL_CRON_SECRET).

export function backupSleutel(): Buffer | null {
  return leesBackupSleutel(process.env.BACKUP_ENCRYPTION_KEY);
}

/** Het sleutel-id (16 hex) van de huidige sleutel, of null. Nooit de sleutel zelf. */
export function huidigSleutelId(): string | null {
  const k = backupSleutel();
  return k ? sleutelIdVan(k) : null;
}

export function cronSecret(): string | null {
  return geldigSecret(process.env.CRON_SECRET);
}

/** Namen van ontbrekende instellingen (nooit waarden). */
export function backupOntbreekt(): string[] {
  const mist: string[] = [];
  if (!backupSleutel()) mist.push(process.env.BACKUP_ENCRYPTION_KEY?.trim() ? 'BACKUP_ENCRYPTION_KEY (ongeldig: 32 bytes base64)' : 'BACKUP_ENCRYPTION_KEY');
  if (!cronSecret()) mist.push(process.env.CRON_SECRET?.trim() ? 'CRON_SECRET (te kort: minstens 16 tekens)' : 'CRON_SECRET');
  for (const d of driveOntbreekt()) mist.push(d);
  return mist;
}
