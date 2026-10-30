import type { ImapFlow } from 'imapflow';
import { mailRoute, json, MAILBOX_ONBEKEND } from '@/lib/mail/api';
import { MailFout } from '@/lib/mail/fout';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, mapVoorRol, parseUid } from '@/lib/mail/mappen';
import { bijlagenUitStructuur, haalBijlage, threadKoppen } from '@/lib/mail/berichten';
import { bouwBericht, parseAdressen, verstuur, type UitgaandeBijlage } from '@/lib/mail/smtp';
import { bouwInhoud, INBOX_TEKST, zoekHandtekening, type Citaat } from '@/lib/mail/handtekening';
import { publiekeOrigin } from '@/lib/auth/site';

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
  /** Gekozen handtekening: een sjabloon-id (lib/mail/handtekening.ts), 'inbox' of leeg. */
  handtekening?: unknown;
  /** Het origineel onder een antwoord/doorgestuurd bericht (kop + tekst). */
  citaat?: { kop?: unknown; tekst?: unknown } | null;
  /** Het bericht waarop je antwoordt of dat je doorstuurt; `mb` = de inbox waar het in staat. */
  origineel?: { mb?: unknown; map?: unknown; uid?: unknown; modus?: unknown } | null;
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

// POST /api/mail/verzenden?mb=<inbox waarvandaan je verstuurt>
//   JSON of multipart (veld "gegevens" = JSON, velden "bijlagen" = bestanden):
//   { aan, cc?, bcc?, onderwerp, tekst, handtekening?, citaat?: { kop, tekst },
//     origineel?: { mb?, map, uid, modus: 'antwoord' | 'doorsturen' }, origineleBijlagen?: string[] }
// Het bericht gaat als HTML (tekst + handtekening + citaat) met een platte-tekstversie ernaast.
// Verstuurt via SMTP van de gekozen inbox (ook een met het team gedeelde), zet een kopie in
// Verzonden van DIE inbox (IMAP APPEND) en markeert bij een antwoord het origineel als
// beantwoord. Antwoorden krijgen In-Reply-To/References (threading). Staat het origineel in
// een andere inbox dan waarvandaan je verstuurt (origineel.mb), dan worden koppen en
// bijlagen daar opgehaald en wordt het daar als beantwoord gemarkeerd.
export const POST = mailRoute(
  async (request: Request, _ctx: unknown, mail) => {
    const { g, bijlagen } = await leesVerzoek(request);

    const aan = parseAdressen(g.aan, 'Aan');
    const cc = parseAdressen(g.cc, 'Cc');
    const bcc = parseAdressen(g.bcc, 'Bcc');
    const onderwerp = String(g.onderwerp ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    const tekst = String(g.tekst ?? '');
    const cit = g.citaat && typeof g.citaat === 'object' ? g.citaat : null;
    const citaatTekst = cit ? String(cit.tekst ?? '').slice(0, 20_000) : '';
    if (tekst.length > 200_000) throw new MailFout(400, 'ongeldig', 'Het bericht is te lang.');
    if (!aan.length && !cc.length && !bcc.length) throw new MailFout(400, 'ongeldig', 'Vul minstens één ontvanger in.');

    const orig = g.origineel && typeof g.origineel === 'object' ? g.origineel : null;
    const modus = orig?.modus === 'antwoord' || orig?.modus === 'doorsturen' ? orig.modus : null;
    const citaat: Citaat | null = cit
      ? { kop: String(cit.kop ?? '').slice(0, 2000), tekst: citaatTekst, antwoord: modus !== 'doorsturen' }
      : null;
    // Alleen een bekend sjabloon of de eigen tekst van de verzendende inbox (die staat op de server).
    const keuze = typeof g.handtekening === 'string' && (zoekHandtekening(g.handtekening) || g.handtekening === INBOX_TEKST) ? g.handtekening : '';
    const inhoud = bouwInhoud(tekst, keuze, mail.cfg?.handtekening ?? '', citaat, publiekeOrigin(request.url));
    const gewensteDelen = Array.isArray(g.origineleBijlagen) ? g.origineleBijlagen.map(String).slice(0, 30) : [];

    // In welke inbox staat het origineel? Standaard dezelfde als waarvandaan je verstuurt;
    // anders alleen een inbox die jij mag zien.
    const origMb = orig && modus && typeof orig.mb === 'string' && orig.mb ? orig.mb : null;
    const andereInbox = origMb !== null && origMb !== mail.mailbox?.id;
    let origCfg = mail.cfg;
    if (andereInbox) {
      const m = mail.mailboxen.find((x) => x.id === origMb);
      if (!m) throw new MailFout(404, 'mailbox_onbekend', MAILBOX_ONBEKEND);
      origCfg = m.cfg;
    }

    type Origineel = { inReplyTo: string | null; references: string[]; map: string; uid: number; bijlagen: UitgaandeBijlage[] };

    // Koppen (threading) en, bij doorsturen, de gekozen originele bijlagen.
    const haalOrigineel = async (c: ImapFlow): Promise<Origineel | null> => {
      if (!orig || !modus) return null;
      const origMap = (await controleerMap(c, String(orig.map ?? ''))).pad;
      const origUid = parseUid(String(orig.uid ?? ''));
      const uit: Origineel = { inReplyTo: null, references: [], map: origMap, uid: origUid, bijlagen: [] };
      if (modus === 'antwoord') {
        const t = await threadKoppen(c, origMap, origUid);
        uit.inReplyTo = t.messageId;
        uit.references = [...t.references, ...(t.messageId ? [t.messageId] : [])].slice(-20);
      } else if (gewensteDelen.length) {
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
          uit.bijlagen.push({ naam: b.naam, type: b.type, inhoud: b.inhoud });
        }
      }
      return uit;
    };

    const markeerBeantwoord = async (c: ImapFlow, o: Origineel | null) => {
      if (modus !== 'antwoord' || !o) return;
      try {
        const lock = await c.getMailboxLock(o.map);
        try {
          await c.messageFlagsAdd(String(o.uid), ['\\Answered'], { uid: true });
        } finally {
          lock.release();
        }
      } catch (e) {
        console.error('[mail] markeren als beantwoord mislukt', (e as Error)?.message ?? e);
      }
    };

    // Verstuurt en bewaart een kopie in Verzonden van de verzendende inbox.
    const verstuurEnBewaar = async (c: ImapFlow, o: Origineel | null) => {
      const { raw, envelope } = await bouwBericht(mail.cfg, {
        aan,
        cc,
        bcc,
        onderwerp,
        tekst: inhoud.text,
        html: inhoud.html,
        inReplyTo: o?.inReplyTo ?? null,
        references: o?.references ?? [],
        bijlagen: [...bijlagen, ...(o?.bijlagen ?? [])]
      });

      await verstuur(mail.cfg, raw, envelope);

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
      return bewaard;
    };

    let bewaard: boolean;
    if (!andereInbox) {
      bewaard = await metImap(mail.cfg, async (c) => {
        const o = await haalOrigineel(c);
        const b = await verstuurEnBewaar(c, o);
        await markeerBeantwoord(c, o);
        return b;
      });
    } else {
      const o = await metImap(origCfg, haalOrigineel);
      bewaard = await metImap(mail.cfg, (c) => verstuurEnBewaar(c, o));
      try {
        await metImap(origCfg, (c) => markeerBeantwoord(c, o));
      } catch (e) {
        console.error('[mail] markeren als beantwoord mislukt', (e as Error)?.message ?? e);
      }
    }

    return json({
      ok: true,
      waarschuwing: bewaard ? undefined : 'Verzonden, maar er kon geen kopie in Verzonden worden bewaard.'
    });
  }
);
