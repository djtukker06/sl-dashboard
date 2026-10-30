import { mailRoute, json, metTijdslimiet } from '@/lib/mail/api';
import { MailFout } from '@/lib/mail/fout';
import { metImap } from '@/lib/mail/imap';
import { laatsteBerichten } from '@/lib/mail/berichten';
import { voegSamenOpDatum } from '@/lib/mail/zichtbaarheid';
import { TIJDSLIMIET_MS } from '@/lib/mail/tellers';
import type { Envelop, MailOverzicht } from '@/lib/mail/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AANTAL = 6;

// GET /api/mail/overzicht → { geconfigureerd, ongelezen, berichten, inboxen, fouten, perInbox }
// voor de inbox-widget op het dashboard: de laatste 6 berichten over ALLE inboxen die je mag
// zien (samengevoegd op datum, elk met het id van zijn inbox) en de som van de ongelezen, plus
// per inbox zijn eigen laatste 6 en ongelezen (de widget kan op één inbox filteren).
// Een inbox die nu niet bereikbaar is, staat in `fouten`; de rest wordt gewoon getoond.
export const GET = mailRoute(async (_request: Request, _ctx: unknown, mail) => {
  const bruikbaar = mail.mailboxen.filter((m) => m.cfg);
  if (!bruikbaar.length) return json({ geconfigureerd: false, ongelezen: 0, berichten: [] } satisfies MailOverzicht);

  const delen = await Promise.all(
    bruikbaar.map(async (m) => {
      try {
        const res = await metTijdslimiet(
          metImap(m.cfg, async (c) => {
            const s = await c.status('INBOX', { unseen: true });
            const berichten = await laatsteBerichten(c, 'INBOX', AANTAL);
            return { ongelezen: s ? (s.unseen ?? 0) : 0, berichten };
          }),
          TIJDSLIMIET_MS
        );
        return { m, ok: true as const, ...res };
      } catch (e) {
        return { m, ok: false as const, fout: e };
      }
    })
  );

  const gelukt = delen.filter((d) => d.ok);
  if (!gelukt.length) {
    // Geen enkele inbox bereikbaar: dezelfde foutmelding als vroeger met één inbox.
    const eerste = delen[0];
    if (eerste && !eerste.ok && eerste.fout instanceof MailFout) throw eerste.fout;
    throw new MailFout(504, 'onbereikbaar', 'De mailserver is nu niet bereikbaar. Probeer het zo opnieuw.');
  }
  const berichten = voegSamenOpDatum<Envelop>(
    gelukt.map((d) => ({ mb: d.m.id, berichten: d.ok ? d.berichten : [] })),
    AANTAL
  );
  return json({
    geconfigureerd: true,
    ongelezen: gelukt.reduce((s, d) => s + (d.ok ? d.ongelezen : 0), 0),
    berichten,
    inboxen: mail.mailboxen.map((m) => ({ id: m.id, label: m.label, email: m.email, kleur: m.kleur })),
    fouten: delen.filter((d) => !d.ok).map((d) => ({ id: d.m.id, label: d.m.label })),
    perInbox: Object.fromEntries(
      gelukt.map((d) => [d.m.id, { ongelezen: d.ok ? d.ongelezen : 0, berichten: d.ok ? d.berichten.map((b) => ({ ...b, mb: d.m.id })) : [] }])
    )
  } satisfies MailOverzicht);
});
