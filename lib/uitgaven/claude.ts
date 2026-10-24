import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';
import {
  CATEGORIEEN,
  jsonUitTekst,
  vindLeverancier,
  type AiVeld,
  type Leverancier,
  type RuwUitgelezen,
  type Uitgave,
  type Uitgelezen,
  type VerplichtVeld,
  VERPLICHTE_VELDEN
} from './model';

// De Claude-kant van het uitlezen: schema, prompt, de aanroep en het samenvoegen met wat
// er al is ingevuld. Bewust zonder '@/'-imports, zodat scripts/test-uitgaven.mjs dit
// bestand los kan laden. Zelfde SDK-patroon als lib/social/claude.ts (env ANTHROPIC_API_KEY).
// Eerst Haiku (snelst en goedkoopst, meestal voldoende); blijft leverancier, datum of
// totaal leeg of onzeker, dan één tweede poging met Sonnet (zelfde schema), zie uitlezen.ts.

export const MODEL = 'claude-haiku-5-5';
export const MODEL_TWEEDE = 'claude-sonnet-5-5';
let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export function heeftApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const leeg = { type: ['string', 'null'] } as const;
const getal = { type: ['number', 'null'] } as const;

/** JSON-schema voor de gestructureerde uitvoer. */
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'leverancier',
    'datum',
    'totaal',
    'btwBedrag',
    'btwTarief',
    'valuta',
    'factuurnummer',
    'omschrijving',
    'categorie',
    'betaalmethode',
    'btwSpecificatie',
    'zekerheid'
  ],
  properties: {
    leverancier: {
      ...leeg,
      description: 'Handelsnaam van de winkel/verkoper (ook herkend aan logo of huisstijl), zonder rechtsvorm (B.V., N.V., Ltd, Inc., GmbH, …). null als niet herkenbaar.'
    },
    datum: { ...leeg, description: 'Aankoop- of factuurdatum in ISO-formaat YYYY-MM-DD. null als niet (zeker) leesbaar.' },
    totaal: {
      ...getal,
      description: 'Het eindbedrag inclusief btw in euro (regel Totaal / Te betalen / PIN). Niet een subtotaal, artikelbedrag, btw of wisselgeld. null als niet (zeker) leesbaar.'
    },
    btwBedrag: { ...getal, description: 'Totaal btw-bedrag (bij meerdere tarieven de som). 0 als er geen btw is of de btw verlegd is.' },
    btwTarief: {
      // Met '%': de API weigert enum-strings die op een getal lijken ('21'); leesTarief haalt het teken weg.
      anyOf: [{ type: 'string', enum: ['21%', '9%', '0%', 'verlegd', 'geen'] }, { type: 'null' }],
      description: 'Btw-tarief. Bij meerdere tarieven: het tarief van het grootste deel.'
    },
    valuta: { ...leeg, description: 'ISO-valutacode, bv. EUR of USD.' },
    factuurnummer: { ...leeg, description: 'Factuur- of bonnummer, als zichtbaar.' },
    omschrijving: { ...leeg, description: 'Korte Nederlandse omschrijving waarvoor het is (max. 8 woorden), bv. "Adobe Creative Cloud maandabonnement".' },
    categorie: {
      anyOf: [{ type: 'string', enum: CATEGORIEEN.map((c) => c.id) }, { type: 'null' }],
      description: 'Best passende categorie.'
    },
    betaalmethode: {
      anyOf: [{ type: 'string', enum: ['zakelijk', 'prive', 'creditcard', 'contant'] }, { type: 'null' }],
      description: 'Alleen als het zichtbaar is: pin/iDEAL/overboeking/incasso = zakelijk, creditcard = creditcard, contant = contant. Anders null.'
    },
    btwSpecificatie: {
      type: 'array',
      description: 'De btw-specificatie van de bon, één regel per tarief, als die er staat; anders een lege lijst.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tarief', 'btw'],
        properties: {
          tarief: { type: 'string', enum: ['21%', '9%', '0%'] },
          btw: { ...getal, description: 'Btw-bedrag bij dit tarief.' }
        }
      }
    },
    zekerheid: {
      type: 'object',
      additionalProperties: false,
      required: ['leverancier', 'datum', 'totaal'],
      description: 'Per verplicht veld: "zeker" als je het duidelijk op het document leest, "onzeker" als je twijfelt (vaag, afgesneden, meerdere kandidaten).',
      properties: {
        leverancier: { type: 'string', enum: ['zeker', 'onzeker'] },
        datum: { type: 'string', enum: ['zeker', 'onzeker'] },
        totaal: { type: 'string', enum: ['zeker', 'onzeker'] }
      }
    }
  }
} as const;

export function systeemPrompt(vandaag: string, bekend: Leverancier[]) {
  const categorieen = CATEGORIEEN.map((c) => `- ${c.id}: ${c.label}`).join('\n');
  const namen = bekend.slice(0, 80).map((l) => l.naam);
  return `Je leest bonnetjes (vaak een telefoonfoto van een kassabon) en (betaalde) inkoopfacturen uit voor de boekhouding van Studio Levant, een kleine Nederlandse ontwerpstudio (eenmanszaak). Vandaag is ${vandaag}.

Geef precies de gevraagde velden terug. De drie belangrijkste zijn leverancier, datum en totaal: lees die altijd zo goed mogelijk uit. Regels:
- Vul alleen in wat je echt op het document ziet; anders null. Verzin niets en gok niet: bij twijfel tussen twee waarden, of als de tekst onleesbaar/afgesneden is, geef null. Een lege waarde vult de gebruiker zelf in; een verkeerde waarde valt niet op.
- zekerheid: geef voor leverancier, datum en totaal "zeker" als je de waarde duidelijk leest, anders "onzeker" (ook als je null teruggeeft).
- Soms krijg je meerdere afbeeldingen van hetzelfde document: de hele bon en vergrote delen ervan (overlappend). Het is één bon; gebruik de vergrote delen om kleine tekst te lezen.
- Bedragen als getal met punt als decimaalteken (12.5), zonder valutateken. Op Nederlandse bonnen is de komma het decimaalteken (16,33 = 16.33).

leverancier:
- De handelsnaam van de winkel of verkoper (niet Studio Levant zelf, dat is de klant). Op kassabonnen staat die vaak alleen als groot logo of woordmerk bovenaan, soms wit op zwart of in een eigen lettertype: herken de winkel dan aan dat logo of de huisstijl. Een duidelijk leesbaar logo is "zeker".
- Ken de bekende ketens, bijvoorbeeld Action, Albert Heijn, Jumbo, Lidl, Aldi, Plus, Dirk, HEMA, Kruidvat, Etos, Blokker, Xenos, Gamma, Praxis, Karwei, Hornbach, IKEA, Bol, Coolblue, MediaMarkt, Shell, BP, Esso, TotalEnergies, Tango, Tinq, NS (voorbeelden, geen volledige lijst).
- Gebruik de naam waaronder de winkel bekend is, zonder rechtsvorm en ruis: geen "B.V.", "N.V.", "V.O.F.", "Ltd", "Inc.", "GmbH", adres, filiaal(nummer), KvK of moederbedrijf uit de kleine lettertjes. Bijvoorbeeld "Albert Heijn" in plaats van "Albert Heijn B.V. filiaal 1234", "Action" in plaats van "Action Nederland".${
    namen.length ? `\n- Is het een van deze eerder gebruikte leveranciers, schrijf de naam dan precies zo: ${namen.join(', ')}.` : ''
  }

totaal:
- Het eindbedrag inclusief btw, in euro (EUR): de regel "Totaal", "Te betalen", "Totaal EUR", "Totaal te betalen", of het afgerekende bedrag bij "PIN", "Pinnen", "Betaald", "Contant" of "Creditcard".
- Niet: een subtotaal vóór korting, het bedrag van één artikel, een btw-bedrag, statiegeld, spaarpunten of wisselgeld. Staat er "Contant 20,00" en "Wisselgeld 3,67", dan is het totaal 16,33 (het te betalen bedrag), niet 20,00.
- Controleer waar het kan: het totaal hoort gelijk te zijn aan het PIN-bedrag en aan de btw-specificatie (excl. + btw). Klopt het niet of zie je twee kandidaten, geef dan null of "onzeker".
- Staat het document in een andere valuta, gebruik dan een vermeld bedrag in euro als dat er is (valuta "EUR"); anders het totaal in die valuta met de juiste valuta-code en zekerheid "onzeker".

datum:
- De aankoop- of factuurdatum in ISO-formaat YYYY-MM-DD: op een kassabon meestal bij de tijd, boven- of onderaan of bij de PIN-gegevens. Niet een vervaldatum, leverdatum, "ruilen tot" of "geldig tot".
- Nederlandse datums zijn dag-maand-jaar: 24-10-26, 24/10/2026, 24.10.2026, 24 okt 2026 en 24 oktober 2026 zijn allemaal 2026-10-24. Een jaar van twee cijfers is 20xx.

btw:
- btwSpecificatie: staat er een btw-overzicht (per tarief bedrag excl./grondslag en btw), geef dan per tarief een regel met het btw-bedrag; anders een lege lijst. btwBedrag = de totale btw op het document (bij meerdere tarieven de som); btwTarief = het tarief van het grootste deel, als "21%", "9%" of "0%".
- Bij "btw verlegd" / "reverse charge" / "VAT reverse charged": btwTarief "verlegd", btwBedrag 0. Buitenlandse factuur zonder btw (bv. een Amerikaans softwarebedrijf): btwTarief "geen", btwBedrag 0.

overig:
- omschrijving: kort en in het Nederlands, waarvoor de uitgave is.
- categorie (id uit deze lijst):
${categorieen}`;
}

export interface ClaudeOpties {
  model?: string;
  /** Inspanning (output_config.effort); weggelaten = de standaard van het model. */
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  maxRetries?: number;
}

/** Eén Claude-aanroep; met JSON-schema, en bij een schemafout één keer zonder. */
export async function vraagClaude(blokken: ContentBlockParam[], systeem: string, opties: ClaudeOpties = {}): Promise<RuwUitgelezen> {
  const vraag: ContentBlockParam = { type: 'text', text: 'Lees dit document uit.' };
  const basis = {
    model: opties.model ?? MODEL,
    max_tokens: 4000,
    system: systeem,
    messages: [{ role: 'user' as const, content: [...blokken, vraag] }]
  };
  const verzoek = { timeout: opties.timeoutMs ?? 50_000, maxRetries: opties.maxRetries ?? 1 };
  let bericht;
  try {
    bericht = await getClient().messages.create(
      {
        ...basis,
        output_config: {
          ...(opties.effort ? { effort: opties.effort } : {}),
          format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> }
        }
      },
      verzoek
    );
  } catch (e) {
    // Een 400 kan op het schema slaan: dan zonder schema, met de opdracht om alleen JSON te geven.
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    console.warn('[uitgaven] gestructureerde uitvoer geweigerd, val terug op tekst:', e.message);
    bericht = await getClient().messages.create(
      {
        ...basis,
        system: `${systeem}\n\nAntwoord uitsluitend met één JSON-object met de sleutels: ${SCHEMA.required.join(', ')}. Gebruik null voor onbekend. zekerheid is een object {"leverancier": "zeker"|"onzeker", "datum": …, "totaal": …}; btwSpecificatie een lijst van {"tarief": "21%", "btw": 1.23}.`
      },
      verzoek
    );
  }
  if (bericht.stop_reason === 'refusal') throw new Error('Het document kon niet worden uitgelezen.');
  const tekst = bericht.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
  const json = jsonUitTekst(tekst);
  if (!json) throw new Error('Het antwoord was geen geldige JSON.');
  return json as RuwUitgelezen;
}

/** Berichtblokken voor afbeeldingen (uit beeld.ts): telkens een korte uitleg en dan het beeld. */
export function beeldBlokken(beelden: { label: string; type: 'image/jpeg' | 'image/png' | 'image/webp'; data: Uint8Array }[], kop = ''): ContentBlockParam[] {
  return beelden.flatMap((b): ContentBlockParam[] => [
    { type: 'text', text: `${kop}${b.label}` },
    { type: 'image', source: { type: 'base64', media_type: b.type, data: Buffer.from(b.data).toString('base64') } }
  ]);
}

/** Moet er een tweede poging komen? Ja als leverancier, datum of totaal leeg of onzeker is. */
export function tweedePogingNodig(r: Uitgelezen): VerplichtVeld[] {
  return VERPLICHTE_VELDEN.filter((v) => r[v] === null || r.onzeker.includes(v));
}

const gelijk = (v: VerplichtVeld, a: unknown, b: unknown) =>
  v === 'totaal'
    ? typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005
    : typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Combineert de eerste (Haiku) en de tweede poging (Sonnet) per verplicht veld:
 *   - wat één van beide zeker leest, wint (zijn beide zeker maar verschillend: Sonnet, onzeker);
 *   - anders de waarde van Sonnet (of Haiku als Sonnet niets heeft), nog steeds onzeker;
 * De overige velden (btw, valuta, …) komen van de poging waar het totaal vandaan komt,
 * aangevuld met de andere. Geeft ook terug welk model wat leverde (voor de log).
 */
export function combineer(a: Uitgelezen, b: Uitgelezen): { r: Uitgelezen; bron: Record<VerplichtVeld, 'eerste' | 'tweede' | 'geen'> } {
  const zeker = (x: Uitgelezen, v: VerplichtVeld) => x[v] !== null && !x.onzeker.includes(v);
  const uit: Record<VerplichtVeld, unknown> = { leverancier: null, datum: null, totaal: null };
  const bron: Record<VerplichtVeld, 'eerste' | 'tweede' | 'geen'> = { leverancier: 'geen', datum: 'geen', totaal: 'geen' };
  const onzeker: VerplichtVeld[] = [];
  for (const v of VERPLICHTE_VELDEN) {
    const za = zeker(a, v);
    const zb = zeker(b, v);
    if (za && zb && !gelijk(v, a[v], b[v])) {
      uit[v] = b[v];
      bron[v] = 'tweede';
      onzeker.push(v);
    } else if (za) {
      uit[v] = a[v];
      bron[v] = 'eerste';
    } else if (zb) {
      uit[v] = b[v];
      bron[v] = 'tweede';
    } else if (b[v] !== null) {
      uit[v] = b[v];
      bron[v] = 'tweede';
      onzeker.push(v);
    } else if (a[v] !== null) {
      uit[v] = a[v];
      bron[v] = 'eerste';
      onzeker.push(v);
    }
  }
  const hoofd = bron.totaal === 'tweede' ? b : a;
  const ander = hoofd === a ? b : a;
  const r: Uitgelezen = {
    leverancier: uit.leverancier as string | null,
    datum: uit.datum as string | null,
    totaal: uit.totaal as number | null,
    btwBedrag: hoofd.btwBedrag ?? ander.btwBedrag,
    btwTarief: hoofd.btwTarief ?? ander.btwTarief,
    valuta: hoofd.valuta ?? ander.valuta,
    factuurnummer: hoofd.factuurnummer ?? ander.factuurnummer,
    omschrijving: hoofd.omschrijving ?? ander.omschrijving,
    categorie: hoofd.categorie ?? ander.categorie,
    betaaldVia: hoofd.betaaldVia ?? ander.betaaldVia,
    onzeker: VERPLICHTE_VELDEN.filter((v) => onzeker.includes(v))
  };
  return { r, bron };
}

/** Logregel zonder waarden (geen bedragen of namen in de logs): per veld zeker/onzeker/leeg. */
export function zekerheidTekst(r: Uitgelezen): string {
  return VERPLICHTE_VELDEN.map((v) => `${v} ${r[v] === null ? 'leeg' : r.onzeker.includes(v) ? 'onzeker' : 'zeker'}`).join(', ');
}

const VELD_KOLOM: Record<AiVeld, string> = {
  leverancier: 'supplier',
  datum: 'expense_date',
  totaal: 'total_amount',
  btwBedrag: 'vat_amount',
  btwTarief: 'vat_rate',
  valuta: 'currency',
  factuurnummer: 'invoice_number',
  omschrijving: 'description',
  categorie: 'category',
  betaaldVia: 'payment_method'
};

/**
 * Welke kolommen het uitgelezen resultaat mag vullen: alleen velden die nu leeg zijn
 * (valuta telt als leeg zolang het EUR is en er nog geen bedrag staat). De laatst gebruikte
 * categorie en betaalwijze van een bekende leverancier gaan vóór de gok van het model.
 */
export function samenvoegen(
  huidig: Uitgave,
  r: Uitgelezen,
  bekend: Leverancier[]
): { kolommen: Record<string, unknown>; velden: AiVeld[]; onzeker: VerplichtVeld[] } {
  const kolommen: Record<string, unknown> = {};
  const velden: AiVeld[] = [];
  const bekende = r.leverancier ? vindLeverancier(r.leverancier, bekend) : null;
  const voorstel: Partial<Record<AiVeld, unknown>> = {
    leverancier: bekende?.naam ?? r.leverancier,
    datum: r.datum,
    totaal: r.totaal,
    btwBedrag: r.btwBedrag,
    btwTarief: r.btwTarief,
    valuta: r.valuta,
    factuurnummer: r.factuurnummer,
    omschrijving: r.omschrijving,
    categorie: bekende?.categorie ?? r.categorie,
    betaaldVia: r.betaaldVia ?? bekende?.betaaldVia ?? null
  };
  const isLeeg: Record<AiVeld, boolean> = {
    leverancier: !huidig.leverancier,
    datum: !huidig.datum,
    totaal: huidig.totaal === null,
    btwBedrag: huidig.btwBedrag === null,
    btwTarief: !huidig.btwTarief,
    valuta: huidig.valuta === 'EUR' && huidig.totaal === null,
    factuurnummer: !huidig.factuurnummer,
    omschrijving: !huidig.omschrijving,
    categorie: !huidig.categorie,
    betaaldVia: !huidig.betaaldVia
  };
  for (const veld of Object.keys(VELD_KOLOM) as AiVeld[]) {
    const w = voorstel[veld];
    if (w === null || w === undefined || w === '' || !isLeeg[veld]) continue;
    if (veld === 'valuta' && w === 'EUR') continue;
    kolommen[VELD_KOLOM[veld]] = w;
    velden.push(veld);
  }
  // Alleen wat nú is ingevuld kan onzeker zijn; een bekende leverancier geldt als zeker.
  const onzeker = r.onzeker.filter((v) => velden.includes(v) && !(v === 'leverancier' && bekende));
  return { kolommen, velden, onzeker };
}

