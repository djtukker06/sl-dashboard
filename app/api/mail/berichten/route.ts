import { mailRoute, json } from '@/lib/mail/api';
import { metImap } from '@/lib/mail/imap';
import { controleerMap } from '@/lib/mail/mappen';
import { berichtenPagina } from '@/lib/mail/berichten';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function geheel(v: string | null, standaard: number, min: number, max: number) {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : standaard;
}

// GET /api/mail/berichten?map=INBOX&pagina=1&per=40&zoek=
//   → { map, pagina, per, totaal, meer, berichten: [envelop] } (nieuwste eerst)
export const GET = mailRoute(async (request: Request, _ctx: unknown, mail) => {
  const sp = new URL(request.url).searchParams;
  const pagina = geheel(sp.get('pagina'), 1, 1, 10_000);
  const per = geheel(sp.get('per'), 40, 1, 100);
  const zoek = (sp.get('zoek') || '').trim();
  const res = await metImap(mail.cfg, async (c) => {
    const map = await controleerMap(c, sp.get('map'));
    return berichtenPagina(c, map.pad, { pagina, per, zoek });
  });
  return json(res);
});
