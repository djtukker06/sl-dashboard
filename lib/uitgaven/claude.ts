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
  type Uitgelezen
} from './model';

// De Claude-kant van het uitlezen: schema, prompt, de aanroep en het samenvoegen met wat
// er al is ingevuld. Bewust zonder '@/'-imports, zodat scripts/test-uitgaven.mjs dit
// bestand los kan laden. Zelfde SDK-patroon als lib/social/claude.ts (env ANTHROPIC_API_KEY).
// Sonnet is ruim voldoende voor bonnetjes en goedkoper dan Opus.

export const MODEL = 'claude-sonnet-5-5';
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
    'betaalmethode'
  ],
  properties: {
    leverancier: { ...leeg, description: 'Naam van de winkel/het bedrijf dat het bonnetje of de factuur uitgaf, zonder rechtsvorm-ruis.' },
    datum: { ...leeg, description: 'Datum van aankoop of factuurdatum, formaat YYYY-MM-DD.' },
    totaal: { ...getal, description: 'Totaalbedrag inclusief btw (wat er betaald is).' },
    btwBedrag: { ...getal, description: 'Totaal btw-bedrag. 0 als er geen btw is of de btw verlegd is.' },
    btwTarief: {
      type: ['string', 'null'],
      enum: ['21', '9', '0', 'verlegd', 'geen', null],
      description: 'Btw-tarief. Bij meerdere tarieven: het tarief van het grootste deel.'
    },
    valuta: { ...leeg, description: 'ISO-valutacode, bv. EUR of USD.' },
    factuurnummer: { ...leeg, description: 'Factuur- of bonnummer, als zichtbaar.' },
    omschrijving: { ...leeg, description: 'Korte Nederlandse omschrijving waarvoor het is (max. 8 woorden), bv. "Adobe Creative Cloud maandabonnement".' },
    categorie: {
      type: ['string', 'null'],
      enum: [...CATEGORIEEN.map((c) => c.id), null],
      description: 'Best passende categorie.'
    },
    betaalmethode: {
      type: ['string', 'null'],
      enum: ['zakelijk', 'prive', 'creditcard', 'contant', null],
      description: 'Alleen als het zichtbaar is: pin/iDEAL/overboeking/incasso = zakelijk, creditcard = creditcard, contant = contant. Anders null.'
    }
  }
} as const;

export function systeemPrompt(vandaag: string, bekend: Leverancier[]) {
  const categorieen = CATEGORIEEN.map((c) => `- ${c.id}: ${c.label}`).join('\n');
  const namen = bekend.slice(0, 80).map((l) => l.naam);
  return `Je leest bonnetjes en (betaalde) inkoopfacturen uit voor de boekhouding van Studio Levant, een kleine Nederlandse ontwerpstudio (eenmanszaak). Vandaag is ${vandaag}.

Geef precies de gevraagde velden terug. Regels:
- Vul alleen in wat je echt op het document ziet; anders null. Verzin niets.
- Bedragen als getal met punt als decimaalteken (12.5), zonder valutateken.
- totaal = het betaalde bedrag inclusief btw. btwBedrag = de totale btw op het document.
- Bij "btw verlegd" / "reverse charge" / "VAT reverse charged": btwTarief "verlegd", btwBedrag 0.
- Buitenlandse factuur zonder btw (bv. een Amerikaans softwarebedrijf): btwTarief "geen", btwBedrag 0.
- Datum als YYYY-MM-DD. Nederlandse datums zijn dag-maand-jaar.
- leverancier: de verkoper (niet Studio Levant zelf, dat is de klant). Gebruik de gangbare naam.${
    namen.length ? `\n  Is het een van deze eerder gebruikte leveranciers, schrijf de naam dan precies zo: ${namen.join(', ')}.` : ''
  }
- omschrijving: kort en in het Nederlands, waarvoor de uitgave is.
- categorie (id uit deze lijst):
${categorieen}`;
}

/** Eén Claude-aanroep; met JSON-schema, en bij een schemafout één keer zonder. */
export async function vraagClaude(blokken: ContentBlockParam[], systeem: string): Promise<RuwUitgelezen> {
  const vraag: ContentBlockParam = { type: 'text', text: 'Lees dit document uit.' };
  const basis = {
    model: MODEL,
    max_tokens: 1500,
    system: systeem,
    messages: [{ role: 'user' as const, content: [...blokken, vraag] }]
  };
  let bericht;
  try {
    bericht = await getClient().messages.create(
      { ...basis, output_config: { format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } } },
      { timeout: 50_000, maxRetries: 1 }
    );
  } catch (e) {
    // Een 400 kan op het schema slaan: dan zonder schema, met de opdracht om alleen JSON te geven.
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    console.warn('[uitgaven] gestructureerde uitvoer geweigerd, val terug op tekst:', e.message);
    bericht = await getClient().messages.create(
      {
        ...basis,
        system: `${systeem}\n\nAntwoord uitsluitend met één JSON-object met de sleutels: ${SCHEMA.required.join(', ')}. Gebruik null voor onbekend.`
      },
      { timeout: 50_000, maxRetries: 1 }
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
): { kolommen: Record<string, unknown>; velden: AiVeld[] } {
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
  return { kolommen, velden };
}

