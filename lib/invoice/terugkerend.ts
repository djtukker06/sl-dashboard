import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { maakFactuurAan } from './aanmaken';
import { renderFactuurPdf } from './opslag';
import { volgendFactuurnummer } from './nummer';
import { veiligeBestandsnaam } from './bestandsnaam';
import type { FactuurInvoer } from './invoer';
import { isAanDeBeurt, naUitvoeren, vulIn, type Interval, type TerugkerendRegel } from './terugkerend-kern';
import { formatEuro } from '@/lib/format';
import { mailConfigVoorTaak } from '@/lib/mail/mailboxen';
import { bouwBericht, parseAdressen, verstuur, type UitgaandeBijlage } from '@/lib/mail/smtp';
import { bouwInhoud, cidVan, standaardKeuze } from '@/lib/mail/handtekening';
import { HANDTEKENING_BEELDEN } from '@/lib/mail/handtekening-beelden';
import { metImap } from '@/lib/mail/imap';
import { mapVoorRol } from '@/lib/mail/mappen';
import { logFout } from '@/lib/log';

// Terugkerende facturen (migratie 0036): het aanmaken en versturen. De dagelijkse cron
// (/api/cron/dagelijks) roept verwerkTerugkerend() aan; de knop "Opnieuw versturen" in het
// beheerscherm verstuurFactuur(). Alles via de service-role: de cron heeft geen gebruiker,
// de routes controleren zelf het teamlidmaatschap.
//
// Dubbel factureren kan niet: een sjabloon wordt eerst "geclaimd" (volgende_datum schuift
// alleen op als hij nog op de oude datum stond), en invoices heeft een unieke index op
// (terugkerend_id, terugkerend_periode). Mislukt het aanmaken, dan gaat de datum terug en
// staat de fout bij het sjabloon; de volgende cronrun probeert het opnieuw.

export interface SjabloonRij {
  id: string;
  client_id: string;
  naam: string;
  regels: TerugkerendRegel[];
  midden_kolom_label: string;
  btw_verlegd: boolean;
  btw_verlegd_als: 'verlegd' | 'nvt';
  btw_verlegd_reden: string;
  interval: Interval;
  dag: number;
  volgende_datum: string;
  eind_datum: string | null;
  actief: boolean;
  versturen: boolean;
  email_aan: string;
  email_cc: string;
  mailbox_id: string;
  onderwerp: string;
  bericht: string;
  laatst_uitgevoerd_op: string | null;
  laatste_factuur_id: string | null;
  laatste_fout: string | null;
  aangemaakt_door: string | null;
  aangemaakt_op: string;
  // Akkoord vooraf (0038); ontbreken vóór die migratie.
  akkoord_vereist?: boolean;
  akkoord_periode?: string | null;
  akkoord_op?: string | null;
}

// Alle kolommen: zo werkt alles ook vóór 0038 (de akkoordkolommen ontbreken dan gewoon).
export const SJABLOON_KOLOMMEN = '*';

export interface Uitkomst {
  sjabloon: string;
  status: 'aangemaakt' | 'verstuurd' | 'wacht_op_akkoord' | 'overgeslagen' | 'mislukt' | 'versturen_mislukt';
  factuurnummer?: string;
  fout?: string;
}

interface KlantRij {
  company_name: string;
  contact_name: string | null;
  address: string | null;
  postal_code: string | null;
}

const kort = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 500);

/** Maakt alle sjablonen aan die vandaag (of eerder, als de cron een dag miste) aan de beurt zijn. */
export async function verwerkTerugkerend(service: SupabaseClient, vandaag: string): Promise<Uitkomst[]> {
  const { data, error } = await service
    .from('terugkerende_facturen')
    .select(SJABLOON_KOLOMMEN)
    .eq('actief', true)
    .lte('volgende_datum', vandaag)
    .order('volgende_datum', { ascending: true })
    .limit(50);
  if (error) {
    // Vóór migratie 0036 bestaat de tabel nog niet: niets te doen.
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw new Error(`Terugkerende facturen ophalen mislukt: ${error.message}`);
  }
  const uit: Uitkomst[] = [];
  for (const s of (data ?? []) as unknown as SjabloonRij[]) {
    try {
      uit.push(await voerUit(service, s, vandaag));
    } catch (e) {
      logFout('[terugkerend] uitvoeren', e);
      uit.push({ sjabloon: s.id, status: 'mislukt', fout: kort(e) });
    }
  }
  return uit;
}

/**
 * "Nu factureren" in het beheerscherm: de factuur voor de eerstvolgende periode meteen
 * aanmaken (en versturen, als dat is ingesteld) in plaats van op de geplande dag.
 */
export async function voerNuUit(service: SupabaseClient, id: string, vandaag: string): Promise<Uitkomst> {
  const { data, error } = await service.from('terugkerende_facturen').select(SJABLOON_KOLOMMEN).eq('id', id).maybeSingle();
  if (error || !data) throw new Error('Deze terugkerende factuur bestaat niet (meer).');
  return voerUit(service, data as unknown as SjabloonRij, vandaag, true);
}

async function voerUit(service: SupabaseClient, s: SjabloonRij, vandaag: string, nu = false): Promise<Uitkomst> {
  if (!isAanDeBeurt(s, nu ? s.volgende_datum : vandaag)) {
    // Voorbij de einddatum: stopzetten in plaats van factureren.
    if (s.actief && s.eind_datum !== null && s.volgende_datum > s.eind_datum) {
      await service.from('terugkerende_facturen').update({ actief: false }).eq('id', s.id);
    }
    return { sjabloon: s.id, status: 'overgeslagen' };
  }

  // Claimen: alleen als niemand anders hem intussen heeft opgeschoven (twee cronruns tegelijk).
  const periode = s.volgende_datum;
  const { volgende, klaar } = naUitvoeren(s);
  const { data: claim } = await service
    .from('terugkerende_facturen')
    .update({ volgende_datum: volgende, actief: !klaar, laatst_uitgevoerd_op: new Date().toISOString() })
    .eq('id', s.id)
    .eq('volgende_datum', periode)
    .eq('actief', true)
    .select('id')
    .maybeSingle();
  if (!claim) return { sjabloon: s.id, status: 'overgeslagen' };

  const terugdraaien = async (fout: string) => {
    await service
      .from('terugkerende_facturen')
      .update({ volgende_datum: periode, actief: true, laatste_fout: fout.slice(0, 1000) })
      .eq('id', s.id);
  };

  let factuur: { id: string; invoiceNumber: string };
  try {
    factuur = await maakFactuur(service, s, periode, vandaag);
  } catch (e) {
    await terugdraaien(`Aanmaken mislukt: ${kort(e)}`);
    throw e;
  }

  await service.from('terugkerende_facturen').update({ laatste_factuur_id: factuur.id, laatste_fout: null }).eq('id', s.id);

  if (!s.versturen) return { sjabloon: s.id, status: 'aangemaakt', factuurnummer: factuur.invoiceNumber };
  // Akkoord vooraf (0038): zonder akkoord voor deze periode wel aanmaken, niet versturen. "Nu
  // factureren" telt als akkoord (je klikt er zelf op en bevestigt).
  if (!nu && s.akkoord_vereist === true && s.akkoord_periode !== periode) {
    await service.from('invoices').update({ wacht_op_akkoord: true }).eq('id', factuur.id);
    return { sjabloon: s.id, status: 'wacht_op_akkoord', factuurnummer: factuur.invoiceNumber };
  }
  try {
    await verstuurFactuur(service, factuur.id, s);
    return { sjabloon: s.id, status: 'verstuurd', factuurnummer: factuur.invoiceNumber };
  } catch (e) {
    const fout = `Factuur ${factuur.invoiceNumber} is aangemaakt, maar versturen is mislukt: ${kort(e)}`;
    await service.from('terugkerende_facturen').update({ laatste_fout: fout.slice(0, 1000) }).eq('id', s.id);
    logFout('[terugkerend] versturen', e);
    return { sjabloon: s.id, status: 'versturen_mislukt', factuurnummer: factuur.invoiceNumber, fout: kort(e) };
  }
}

async function klantVan(service: SupabaseClient, s: SjabloonRij): Promise<KlantRij> {
  const { data: klant, error } = await service
    .from('clients')
    .select('company_name, contact_name, address, postal_code')
    .eq('id', s.client_id)
    .maybeSingle();
  if (error || !klant) throw new Error('De klant bestaat niet meer.');
  return klant as KlantRij;
}

/** De factuur zoals hij voor `periode` wordt: klantgegevens van nu, placeholders ingevuld. */
function bouwInvoer(s: SjabloonRij, k: KlantRij, periode: string, datum: string, nummer: { factuurnummer: string; jaar: number; volgnummer: number }): FactuurInvoer {
  const p = { datum: periode, interval: s.interval, dag: s.dag, klant: k.company_name };
  return {
    factuurnummer: nummer.factuurnummer,
    jaar: nummer.jaar,
    volgnummer: nummer.volgnummer,
    issuedAt: `${datum}T12:00:00Z`,
    naamFactuur: `Factuur ${nummer.factuurnummer} · ${vulIn(s.naam, p)}`.slice(0, 200),
    klant: { bedrijfsnaam: k.company_name, tav: k.contact_name || '', adres: k.address || '', postcode: k.postal_code || '' },
    middenKolomLabel: s.midden_kolom_label,
    btwVerlegd: s.btw_verlegd,
    btwVerlegdAls: s.btw_verlegd_als,
    btwVerlegdReden: s.btw_verlegd ? s.btw_verlegd_reden : '',
    aanbetalingPercentage: null,
    regels: s.regels.map((r) => ({
      beschrijving: vulIn(r.beschrijving, p),
      midden: vulIn(r.midden, p),
      totaal: r.totaal,
      teltMeeInOmzet: r.teltMeeInOmzet
    }))
  };
}

/**
 * Voorbeeld van de eerstvolgende factuur als PDF, precies zoals de cron hem op de geplande dag
 * maakt (met het nummer dat hij nu zou krijgen). Er wordt niets opgeslagen of verstuurd.
 */
export async function voorbeeldPdf(service: SupabaseClient, id: string): Promise<{ pdf: Buffer; naam: string }> {
  const { data, error } = await service.from('terugkerende_facturen').select(SJABLOON_KOLOMMEN).eq('id', id).maybeSingle();
  if (error || !data) throw new Error('Deze terugkerende factuur bestaat niet (meer).');
  const s = data as unknown as SjabloonRij;
  const datum = s.volgende_datum;
  const nummer = await volgendFactuurnummer(service, Number(datum.slice(0, 4)));
  const invoer = bouwInvoer(s, await klantVan(service, s), datum, datum, nummer);
  return { pdf: await renderFactuurPdf(invoer), naam: `Voorbeeld ${invoer.naamFactuur}` };
}

/** De factuur voor één periode: klantgegevens van nu, nummer = hoogste van het jaar + 1. */
async function maakFactuur(service: SupabaseClient, s: SjabloonRij, periode: string, vandaag: string) {
  const k = await klantVan(service, s);

  // Twee pogingen: grijpt een gelijktijdig aangemaakte factuur net hetzelfde nummer, dan
  // weigert create_invoice het en nemen we het volgende.
  let laatsteFout = '';
  for (let poging = 0; poging < 2; poging++) {
    const nummer = await volgendFactuurnummer(service, Number(vandaag.slice(0, 4)));
    const invoer = bouwInvoer(s, k, periode, vandaag, nummer);
    const r = await maakFactuurAan(service, { invoer, clientId: s.client_id });
    if (!r.ok) {
      laatsteFout = r.fout;
      // "… is wel aangemaakt": dan bestaat hij en proberen we het niet nog eens.
      if (/wel aangemaakt/.test(r.fout) || !/al gebruikt|duplicate|unique/i.test(r.fout)) break;
      continue;
    }
    const { error: koppelFout } = await service
      .from('invoices')
      .update({ terugkerend_id: s.id, terugkerend_periode: periode, created_by: s.aangemaakt_door })
      .eq('id', r.id);
    if (koppelFout) {
      // De unieke index: deze periode is al gefactureerd. Deze dubbele weer weg.
      await service.from('invoices').delete().eq('id', r.id);
      throw new Error(`Periode ${periode} is al gefactureerd (${koppelFout.message}).`);
    }
    return { id: r.id, invoiceNumber: r.invoiceNumber };
  }
  throw new Error(laatsteFout || 'Factuur aanmaken mislukt.');
}

/**
 * Mailt een (terugkerende) factuur met de PDF als bijlage, vanaf de gekozen inbox, met de
 * handtekening van die inbox; een kopie gaat in Verzonden. Legt verzonden_op/-aan vast.
 */
export async function verstuurFactuur(
  service: SupabaseClient,
  factuurId: string,
  s: Pick<SjabloonRij, 'interval' | 'dag' | 'email_aan' | 'email_cc' | 'mailbox_id' | 'onderwerp' | 'bericht'>
): Promise<void> {
  const { data: f, error } = await service
    .from('invoices')
    .select('id, name, invoice_number, total, pdf_path, client_company_name, client_contact_name, terugkerend_periode, issued_at')
    .eq('id', factuurId)
    .maybeSingle();
  if (error || !f) throw new Error('Factuur niet gevonden.');
  if (!f.pdf_path) throw new Error('De factuur heeft (nog) geen PDF.');

  const cfg = await mailConfigVoorTaak(service, s.mailbox_id);
  if (!cfg) throw new Error('De gekozen inbox is niet (meer) gekoppeld. Kies een andere inbox bij de terugkerende factuur.');

  const { data: bestand, error: downloadFout } = await service.storage.from('invoices').download(f.pdf_path);
  if (downloadFout || !bestand) throw new Error('Kon de factuur-PDF niet ophalen.');

  const p = {
    datum: (f.terugkerend_periode as string | null) ?? String(f.issued_at).slice(0, 10),
    interval: s.interval,
    dag: s.dag,
    factuurnummer: f.invoice_number as string,
    bedrag: `€ ${formatEuro(Number(f.total))}`,
    klant: (f.client_contact_name as string | null) || (f.client_company_name as string)
  };
  const aan = parseAdressen(s.email_aan, 'Aan');
  const cc = parseAdressen(s.email_cc, 'Cc');
  const inhoud = bouwInhoud(vulIn(s.bericht, p), standaardKeuze({ email: cfg.user, handtekening: cfg.handtekening }, cfg.user), cfg.handtekening, null);
  const inline: UitgaandeBijlage[] = [...new Set(inhoud.beelden)].map((b) => ({
    naam: b,
    type: 'image/png',
    inhoud: Buffer.from(HANDTEKENING_BEELDEN[b], 'base64'),
    cid: cidVan(b)
  }));
  const { raw, envelope } = await bouwBericht(cfg, {
    aan,
    cc,
    bcc: [],
    onderwerp: vulIn(s.onderwerp, p).slice(0, 300),
    tekst: inhoud.text,
    html: inhoud.html,
    inline,
    bijlagen: [
      {
        naam: veiligeBestandsnaam((f.name as string | null) || '', `Factuur ${f.invoice_number}`),
        type: 'application/pdf',
        inhoud: Buffer.from(await bestand.arrayBuffer())
      }
    ]
  });
  await verstuur(cfg, raw, envelope);

  // Vanaf hier is hij verstuurd; een mislukte kopie in Verzonden maakt dat niet ongedaan.
  await service
    .from('invoices')
    .update({ verzonden_op: new Date().toISOString(), verzonden_aan: [...aan, ...cc].map((a) => a.adres).join(', ').slice(0, 1000) })
    .eq('id', factuurId);
  // Wachtte hij op akkoord (0038), dan nu niet meer. Vóór 0038 bestaat de kolom niet: geen probleem.
  await service.from('invoices').update({ wacht_op_akkoord: false }).eq('id', factuurId).eq('wacht_op_akkoord', true);
  try {
    await metImap(cfg, async (c) => {
      const map = await mapVoorRol(c, 'verzonden', true);
      if (map) await c.append(map, raw, ['\\Seen'], new Date());
    });
  } catch (e) {
    console.error('[terugkerend] kopie in Verzonden mislukt', kort(e));
  }
}
