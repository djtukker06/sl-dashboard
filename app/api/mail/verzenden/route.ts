import { mailRoute, json } from '@/lib/mail/api';
import { MailFout } from '@/lib/mail/fout';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, mapVoorRol, parseUid } from '@/lib/mail/mappen';
import { bijlagenUitStructuur, haalBijlage, threadKoppen } from '@/lib/mail/berichten';
import { bouwBericht, parseAdressen, verstuur, type UitgaandeBijlage } from '@/lib/mail/smtp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vercel accepteert max. 4,5 MB per verzoek; eigen bijlagen samen max. 4 MB. */
const MAX_UPLOAD = 4 * 1024 * 1024;
/** Bij doorsturen gaan de originele bijlagen server-side mee (geen uploadlimiet), tot 20 MB. */
const MAX_DOORSTUREN = 20 * 1024 * 1024;

type Gegevens = {
  aan?: unknown;
  cc?: unknown;
  bcc?: unknown;
  onderwerp?: unknown;
  tekst?: unknown;
  origineel?: { map?: unknown; uid?: unknown; modus?: unknown } | null;
  /** Bij doorsturen: welke originele bijlagen mee moeten (deelnummers). */
  origineleBijlagen?: unknown;
};

async function leesVerzoek(request: Request): Promise<{ g: Gegevens; bijlagen: UitgaandeBijlage[] }> {
  const type = request.headers.get('content-type') || '';
  const lengte = Number(request.headers.get('content-length') || 0);
  if (lengte > MAX_UPLOAD + 512 * 1024) throw new MailFout(413, 'te_groot', 'De bijlagen zijn samen te groot (max. 4 MB).');

  if (type.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) throw new MailFout(400, 'ongeldig', 'Ongeldig verzoek.');
    let g: Gegevens = {};
    try {
      g = JSON.parse(String(form.get('gegevens') || '{}'));
    } catch {
      throw new MailFout(400, 'ongeldig', 'Ongeldig verzoek.');
    }
    const bijlagen: UitgaandeBijlage[] = [];
    let totaal = 0;
    for (const v of form.getAll('bijlagen')) {
      if (typeof v === 'string') continue;
      totaal += v.size;
      if (totaal > MAX_UPLOAD) throw new MailFout(413, 'te_groot', 'De bijlagen zijn samen te groot (max. 4 MB).');
      bijlagen.push({
        naam: (v.name || 'bijlage').slice(0, 200),
        type: v.type || 'application/octet-stream',
        inhoud: Buffer.from(await v.arrayBuffer())
      });
    }
    if (bijlagen.length > 20) throw new MailFout(400, 'ongeldig', 'Maximaal 20 bijlagen.');
    return { g: g && typeof g === 'object' ? g : {}, bijlagen };
  }

  const g = (await request.json().catch(() => null)) as Gegevens | null;
  if (!g || typeof g !== 'object') throw new MailFout(400, 'ongeldig', 'Ongeldig verzoek.');
  return { g, bijlagen: [] };
}

// POST /api/mail/verzenden
//   JSON of multipart (veld "gegevens" = JSON, velden "bijlagen" = bestanden):
//   { aan, cc?, bcc?, onderwerp, tekst, origineel?: { map, uid, modus: 'antwoord' | 'doorsturen' },
//     origineleBijlagen?: string[] }
// Verstuurt via SMTP, zet een kopie in Verzonden (IMAP APPEND) en markeert bij een antwoord
// het origineel als beantwoord. Antwoorden krijgen In-Reply-To/References (threading).
export const POST = mailRoute(
  async (request: Request) => {
    const { g, bijlagen } = await leesVerzoek(request);

    const aan = parseAdressen(g.aan, 'Aan');
    const cc = parseAdressen(g.cc, 'Cc');
    const bcc = parseAdressen(g.bcc, 'Bcc');
    const onderwerp = String(g.onderwerp ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    const tekst = String(g.tekst ?? '');
    if (tekst.length > 200_000) throw new MailFout(400, 'ongeldig', 'Het bericht is te lang.');
    if (!aan.length && !cc.length && !bcc.length) throw new MailFout(400, 'ongeldig', 'Vul minstens één ontvanger in.');

    const orig = g.origineel && typeof g.origineel === 'object' ? g.origineel : null;
    const modus = orig?.modus === 'antwoord' || orig?.modus === 'doorsturen' ? orig.modus : null;
    const gewensteDelen = Array.isArray(g.origineleBijlagen) ? g.origineleBijlagen.map(String).slice(0, 30) : [];

    const resultaat = await metImap(async (c) => {
      let inReplyTo: string | null = null;
      let references: string[] = [];
      let origMap: string | null = null;
      let origUid: number | null = null;
      const alleBijlagen = [...bijlagen];

      if (orig && modus) {
        origMap = (await controleerMap(c, String(orig.map ?? ''))).pad;
        origUid = parseUid(String(orig.uid ?? ''));
        if (modus === 'antwoord') {
          const t = await threadKoppen(c, origMap, origUid);
          inReplyTo = t.messageId;
          references = [...t.references, ...(t.messageId ? [t.messageId] : [])].slice(-20);
        } else if (gewensteDelen.length) {
          // Doorsturen: de gekozen originele bijlagen gaan mee.
          const lock = await c.getMailboxLock(origMap, { readOnly: true });
          let delen: string[] = [];
          try {
            const kop = await c.fetchOne(String(origUid), { uid: true, bodyStructure: true }, { uid: true });
            const beschikbaar = kop ? bijlagenUitStructuur(kop.bodyStructure) : [];
            delen = beschikbaar.filter((b) => gewensteDelen.includes(b.deel)).map((b) => b.deel);
          } finally {
            lock.release();
          }
          let totaal = 0;
          for (const deel of delen) {
            const b = await haalBijlage(c, origMap, origUid, deel, MAX_DOORSTUREN);
            totaal += b.inhoud.length;
            if (totaal > MAX_DOORSTUREN) {
              throw new MailFout(413, 'te_groot', 'De originele bijlagen zijn samen te groot om door te sturen (max. 20 MB).');
            }
            alleBijlagen.push({ naam: b.naam, type: b.type, inhoud: b.inhoud });
          }
        }
      }

      const { raw, envelope } = await bouwBericht({
        aan,
        cc,
        bcc,
        onderwerp,
        tekst,
        inReplyTo,
        references,
        bijlagen: alleBijlagen
      });

      await verstuur(raw, envelope);

      // Vanaf hier is het bericht verstuurd: fouten maken het verzoek niet meer "mislukt".
      let bewaard = true;
      try {
        const verzonden = await mapVoorRol(c, 'verzonden', true);
        if (verzonden) await c.append(verzonden, raw, ['\\Seen'], new Date());
        else bewaard = false;
      } catch (e) {
        bewaard = false;
        console.error('[mail] kopie in Verzonden mislukt', (e as Error)?.message ?? e);
      }
      if (modus === 'antwoord' && origMap && origUid) {
        try {
          const lock = await c.getMailboxLock(origMap);
          try {
            await c.messageFlagsAdd(String(origUid), ['\\Answered'], { uid: true });
          } finally {
            lock.release();
          }
        } catch (e) {
          console.error('[mail] markeren als beantwoord mislukt', (e as Error)?.message ?? e);
        }
      }
      return { bewaard };
    });

    return json({
      ok: true,
      waarschuwing: resultaat.bewaard ? undefined : 'Verzonden, maar er kon geen kopie in Verzonden worden bewaard.'
    });
  },
  { muterend: true }
);
