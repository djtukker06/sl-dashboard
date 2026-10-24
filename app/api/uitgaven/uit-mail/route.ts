import { randomUUID } from 'node:crypto';
import { vandaag as vandaagNL } from '@/lib/agenda/datum';
import { haalBijlage } from '@/lib/mail/berichten';
import { MailFout } from '@/lib/mail/fout';
import { mailConfigVoor } from '@/lib/mail/config';
import { metImap } from '@/lib/mail/imap';
import { controleerMap, parseUid } from '@/lib/mail/mappen';
import { dbFout, fout, json, leesJson, uitgavenRoute } from '@/lib/uitgaven/api';
import { isBestandsType, MAX_BESTAND_BYTES, schoon, snuffelType, typeUitNaam } from '@/lib/uitgaven/model';
import { nieuwPad, upload, verwijder } from '@/lib/uitgaven/opslag';
import { heeftSoortKolom, kolomOntbreekt, moetUitgave } from '@/lib/uitgaven/repo';
import { leesUitgaveUit } from '@/lib/uitgaven/uitlezen';
import { naDriveUitgave } from '@/lib/drive/kopieen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// IMAP + HEIC omzetten + Sonnet + zo nodig een tweede poging met Opus.
export const maxDuration = 120;

// POST /api/uitgaven/uit-mail  { map, uid, deel, onderwerp? } → { uitgave }
// "Opslaan als uitgave" in de mail-lezer: haalt de bijlage server-side op via IMAP (zoals de
// download-route), zet hem in de bucket uitgaven, maakt een concept en leest het uit.
export const POST = uitgavenRoute(async (request, _ctx, sb, lid) => {
  const b = await leesJson(request);
  const deel = typeof b.deel === 'string' ? b.deel : '';
  const mapNaam = typeof b.map === 'string' ? b.map : 'INBOX';

  let bijlage: { naam: string; type: string; inhoud: Buffer };
  let cfg: Awaited<ReturnType<typeof mailConfigVoor>> = null;
  try {
    const uid = parseUid(String(b.uid ?? ''));
    // Altijd de eigen mailbox van dit teamlid (nooit die van een ander).
    cfg = await mailConfigVoor(lid);
    bijlage = await metImap(cfg, async (c) => {
      const map = await controleerMap(c, mapNaam);
      return haalBijlage(c, map.pad, uid, deel, MAX_BESTAND_BYTES);
    });
  } catch (e) {
    if (e instanceof MailFout) return fout(e.status, e.message, e.code);
    throw e;
  }

  // Het echte type uit de inhoud; de naam of het opgegeven type als die niets zegt.
  const type =
    snuffelType(bijlage.inhoud.subarray(0, 16)) ??
    typeUitNaam(bijlage.naam) ??
    (isBestandsType(bijlage.type) ? bijlage.type : null);
  if (!type) return fout(400, 'Alleen PDF’s en foto’s (jpg, png, webp, heic) kunnen als uitgave worden opgeslagen.');

  const id = randomUUID();
  const pad = nieuwPad(id, bijlage.naam || 'bijlage', type);
  await upload(pad, bijlage.inhoud, type);

  const onderwerp = schoon(b.onderwerp, 300);
  const bron = cfg?.user ? ` (${cfg.user})` : '';
  const basis: Record<string, unknown> = {
    id,
    source: 'mail',
    created_by: lid.userId,
    source_ref: (onderwerp ? `Mail${bron}: ${onderwerp}` : `Mail${bron}`).slice(0, 500)
  };
  const soort = type === 'application/pdf' ? 'inkoopfactuur' : 'bonnetje';
  let nieuw = await sb.from('expenses').insert(heeftSoortKolom() ? { ...basis, soort } : basis);
  if (nieuw.error && kolomOntbreekt(nieuw.error)) nieuw = await sb.from('expenses').insert(basis);
  if (nieuw.error) {
    await verwijder([pad]);
    throw dbFout(nieuw.error);
  }
  const bestand = await sb
    .from('expense_files')
    .insert({
      expense_id: id,
      storage_path: pad,
      file_name: schoon(bijlage.naam, 200) || pad.split('/').pop(),
      mime_type: type,
      size_bytes: bijlage.inhoud.length
    })
    .select('id')
    .maybeSingle();
  if (bestand.error) {
    await sb.from('expenses').delete().eq('id', id);
    await verwijder([pad]);
    throw dbFout(bestand.error);
  }
  // Uitlezen mislukt nooit hard: dan blijft het een concept om zelf in te vullen. Daarna de
  // kopie naar Google Drive (Boekhouding/Bonnetjes/<jaar>, naam met datum/leverancier/bedrag),
  // ná het antwoord en best effort.
  try {
    const uitgave = await leesUitgaveUit(sb, id, vandaagNL());
    naDriveUitgave(lid, id);
    return json({ uitgave }, 201);
  } catch (e) {
    console.error('[uitgaven] uitlezen na mail', (e as Error)?.message ?? e);
    naDriveUitgave(lid, id);
    const { uitgave } = await moetUitgave(sb, id);
    return json({ uitgave }, 201);
  }
});
