import { mailRoute, json } from '@/lib/mail/api';
import { metImap } from '@/lib/mail/imap';
import { lijstMappen } from '@/lib/mail/mappen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/mail/mappen → { mappen: [{ pad, naam, rol, ongelezen, totaal, niveau }] }
export const GET = mailRoute(async () => {
  const mappen = await metImap((c) => lijstMappen(c, { status: true }));
  return json({ mappen });
});
