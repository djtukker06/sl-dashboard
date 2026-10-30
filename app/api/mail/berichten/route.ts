import { mailRoute, json, metTijdslimiet } from '@/lib/mail/api';
import { MailFout } from '@/lib/mail/fout';
import { metImap } from '@/lib/mail/imap';
import { controleerMap } from '@/lib/mail/mappen';
import { berichtenPagina } from '@/lib/mail/berichten';
import { voegSamenOpDatum } from '@/lib/mail/zichtbaarheid';
import type { BerichtenPagina, Envelop } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per inbox bij "Alle inboxen" (de lijst van één inbox kent geen tijdslimiet). */
const TIJDSLIMIET_ALLE_MS = 12_000;

function geheel(v: string | null, standaard: number, min: number, max: number) {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : standaard;
}

// GET /api/mail/berichten?mb=<inbox>&map=INBOX&pagina=1&per=40&zoek=
//   → { map, pagina, per, totaal, meer, berichten: [envelop + mb] } (nieuwste eerst)
// GET /api/mail/berichten?alle=1&pagina=1&per=40&zoek=
//   "Alle inboxen": pagina N van de INBOX van elke inbox die je mag zien, samengevoegd op
//   datum (elk bericht met het id van zijn inbox). `meer` zolang één inbox nog meer heeft.
//   Een inbox die nu niet reageert staat in `fouten`; de rest wordt gewoon getoond.
export const GET = mailRoute(async (request: Request, _ctx: unknown, mail) => {
  const sp = new URL(request.url).searchParams;
  const pagina = geheel(sp.get('pagina'), 1, 1, 10_000);
  const per = geheel(sp.get('per'), 40, 1, 100);
  const zoek = (sp.get('zoek') || '').trim();

  if (sp.get('alle') === '1') {
    const bruikbaar = mail.mailboxen.filter((m) => m.cfg);
    const delen = await Promise.all(
      bruikbaar.map(async (m) => {
        try {
          const res = await metTijdslimiet(
            metImap(m.cfg, (c) => berichtenPagina(c, 'INBOX', { pagina, per, zoek })),
            TIJDSLIMIET_ALLE_MS
          );
          return { m, res };
        } catch (e) {
          return { m, res: null, fout: e };
        }
      })
    );
    const gelukt = delen.filter((d) => d.res);
    if (!gelukt.length && delen.length) {
      const f = delen[0].fout;
      if (f instanceof MailFout) throw f;
      throw new MailFout(504, 'onbereikbaar', 'De mailserver is nu niet bereikbaar. Probeer het zo opnieuw.');
    }
    if (!delen.length) throw new MailFout(503, 'niet_gekoppeld', 'Er is nog geen inbox gekoppeld.');
    const berichten = voegSamenOpDatum<Envelop>(gelukt.map((d) => ({ mb: d.m.id, berichten: d.res!.berichten })));
    return json({
      map: 'INBOX',
      pagina,
      per,
      totaal: gelukt.reduce((s, d) => s + d.res!.totaal, 0),
      meer: gelukt.some((d) => d.res!.meer),
      berichten,
      fouten: delen.filter((d) => !d.res).map((d) => ({ id: d.m.id, label: d.m.label })),
      geldigheid: Object.fromEntries(gelukt.map((d) => [d.m.id, d.res!.uidValidity]))
    } satisfies BerichtenPagina);
  }

  const res = await metImap(mail.cfg, async (c) => {
    const map = await controleerMap(c, sp.get('map'));
    return berichtenPagina(c, map.pad, { pagina, per, zoek });
  });
  const mb = mail.mailbox?.id;
  const { uidValidity, ...rest } = res;
  return json(
    mb
      ? ({ ...rest, berichten: res.berichten.map((e) => ({ ...e, mb })), geldigheid: { [mb]: uidValidity } } satisfies BerichtenPagina)
      : rest
  );
});
