import Link from 'next/link';
import type { Teamlid } from '@/lib/auth/team';
import { backupStatus, waarschuwingVan } from '@/lib/backup/status';
import { logWaarschuwing } from '@/lib/log';

// Alleen voor de eigenaar (met 2FA-sessie): een balk op het dashboard als de laatste
// back-up is mislukt, de laatste geslaagde ouder is dan 2 dagen, of de keep-alive al 3 dagen
// niets heeft gedaan. Alles in orde = niets zichtbaar. Een fout bij het lezen houdt het
// dashboard nooit op.
export async function BackupWaarschuwing({ lid }: { lid: Teamlid }) {
  if (lid.rol !== 'eigenaar' || lid.overgang || lid.tfa.aal !== 'aal2') return null;
  let w;
  try {
    w = waarschuwingVan(await backupStatus(lid.sb));
  } catch (e) {
    logWaarschuwing('[dashboard] back-upstatus', e);
    return null;
  }
  if (!w) return null;
  return (
    <p className={`db-backup${w.soort === 'niet_ingericht' ? ' is-zacht' : ''}`} role="status">
      <strong>{w.soort === 'niet_ingericht' ? 'Back-ups' : 'Let op'}</strong>
      <span>{w.tekst}</span>
      <Link href="/beveiliging#backups">Bekijken</Link>
    </p>
  );
}
