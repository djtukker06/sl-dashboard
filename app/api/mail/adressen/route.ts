import type { ImapFlow } from 'imapflow';
import { mailRoute, json } from '@/lib/mail/api';
import { mailConfig } from '@/lib/mail/config';
import { metImap } from '@/lib/mail/imap';
import { mapVoorRol } from '@/lib/mail/mappen';
import type { Adres } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AANTAL = 150;

async function recenteAdressen(c: ImapFlow, map: string, velden: ('from' | 'to' | 'cc')[]) {
  const lock = await c.getMailboxLock(map, { readOnly: true });
  try {
    const exists = c.mailbox ? c.mailbox.exists : 0;
    if (!exists) return [];
    const laag = Math.max(1, exists - AANTAL + 1);
    const uit: { adres: Adres; datum: number }[] = [];
    for (const m of await c.fetchAll(`${laag}:${exists}`, { envelope: true })) {
      const datum = m.envelope?.date ? new Date(m.envelope.date).getTime() || 0 : 0;
      for (const veld of velden) {
        for (const a of m.envelope?.[veld] ?? []) {
          if (a.address) uit.push({ adres: { naam: (a.name || '').trim(), adres: a.address.trim().toLowerCase() }, datum });
        }
      }
    }
    return uit;
  } finally {
    lock.release();
  }
}

// GET /api/mail/adressen → { adressen: [{ naam, adres }] }
// Adressuggesties voor het opstelscherm: recente afzenders (inbox) en ontvangers (verzonden),
// meest recent en vaakst gebruikt eerst. Wordt pas opgehaald als je een mail opstelt.
export const GET = mailRoute(async () => {
  const eigen = mailConfig()?.user.toLowerCase() ?? '';
  const lijst = await metImap(async (c) => {
    const inbox = await recenteAdressen(c, 'INBOX', ['from']);
    const verzondenPad = await mapVoorRol(c, 'verzonden');
    const verzonden = verzondenPad ? await recenteAdressen(c, verzondenPad, ['to', 'cc']) : [];
    return [...verzonden, ...inbox];
  });

  const score = new Map<string, { adres: Adres; score: number }>();
  for (const { adres, datum } of lijst) {
    if (!adres.adres || adres.adres === eigen || /no-?reply|mailer-daemon|notifications?@/i.test(adres.adres)) continue;
    const s = score.get(adres.adres);
    const punten = 1 + datum / 1e13;
    if (s) {
      s.score += punten;
      if (!s.adres.naam && adres.naam) s.adres.naam = adres.naam;
    } else score.set(adres.adres, { adres, score: punten });
  }
  const adressen = [...score.values()].sort((a, b) => b.score - a.score).slice(0, 300).map((s) => s.adres);
  return json({ adressen });
});
