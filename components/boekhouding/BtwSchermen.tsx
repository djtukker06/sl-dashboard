import 'server-only';
import Link from 'next/link';
import { BoekhoudingKop } from './BoekhoudingKop';
import { Demo } from './Schermen';
import { AangifteApp, type AangifteView, type PostRij } from './AangifteApp';
import { formatCenten } from '@/lib/boekhouding/kern/geld';
import { aangifteDeadline, jaarVan, korteDatum, kwartaalGrenzen, kwartaalLabel, langeDatum, plusDagen, vandaagNL, type Kwartaal } from '@/lib/boekhouding/kern/periode';
import { aangifteRubrieken, kwartaalOverzicht, volgendeAangifte, type KwartaalRij, type KwartaalStatus } from '@/lib/boekhouding/kern/aangifte';
import { btwControles } from '@/lib/boekhouding/kern/btw-controles';
import { berekenBoeking } from '@/lib/boekhouding/model';
import { journaalVan, laadAlles, type BoekhoudData, type BoekhoudRepo } from '@/lib/boekhouding/repo/types';
import type { JournaalPost } from '@/lib/boekhouding/kern/journaal';

// De btw-schermen: het overzicht per kwartaal en de aangifte van één kwartaal (zoals het
// formulier van de Belastingdienst, met doorklik naar de posten en de controles).

export const STATUS_LABEL: Record<KwartaalStatus, { label: string; klasse: string }> = {
  lopend: { label: 'loopt nog', klasse: 'is-zacht' },
  te_doen: { label: 'aangifte doen', klasse: 'is-let-op' },
  te_laat: { label: 'te laat', klasse: 'is-gevaar' },
  ingediend: { label: 'ingediend', klasse: 'is-koppel' },
  betaald: { label: 'ingediend · betaald', klasse: 'is-koppel' }
};

/** Vanaf wanneer we kwartalen tonen: de start van de administratie (of het vroegste beginsaldo). */
function startVan(d: BoekhoudData, vandaag: string): string {
  const kandidaten = [d.stam.instellingen.startdatum, ...d.stam.rekeningen.map((r) => r.begindatum)].filter((x): x is string => !!x);
  const begin = kandidaten.length ? kandidaten.sort()[0] : `${jaarVan(vandaag)}-01-01`;
  return begin > vandaag ? vandaag : begin;
}

function kwartalen(d: BoekhoudData, posten: JournaalPost[], vandaag: string): KwartaalRij[] {
  return kwartaalOverzicht({ posten, aangiften: d.aangiften, betalingen: d.aangifteBetalingen, vanaf: startVan(d, vandaag), vandaag });
}

const bedragLabel = (c: number) => (c > 0 ? 'te betalen' : c < 0 ? 'terug te ontvangen' : 'niets te betalen');

export async function BtwScherm({ repo }: { repo: BoekhoudRepo }) {
  const data = await laadAlles(repo);
  const vandaag = vandaagNL();
  const rijen = kwartalen(data, journaalVan(data), vandaag);
  const volgende = volgendeAangifte(rijen);
  const dagen = volgende ? Math.round((Date.parse(`${volgende.deadline}T12:00:00Z`) - Date.parse(`${vandaag}T12:00:00Z`)) / 86_400_000) : 0;

  return (
    <div className="bh">
      <BoekhoudingKop titel="Btw-aangifte" />
      <Demo repo={repo} />
      <div className="bh-inhoud bh-btw">
        {volgende && (
          <section className={`bh-kaart bh-btw-volgende${volgende.status === 'te_laat' ? ' is-te-laat' : ''}`} aria-labelledby="bh-btw-volgende">
            <div className="bh-btw-volgende-tekst">
              <p className="bh-label">{volgende.status === 'lopend' ? 'Lopend kwartaal' : 'Volgende aangifte'}</p>
              <h2 id="bh-btw-volgende" className="bh-btw-volgende-titel">
                {kwartaalLabel(volgende.jaar, volgende.kwartaal)}
                <span className={`bh-pil ${STATUS_LABEL[volgende.status].klasse}`}>{STATUS_LABEL[volgende.status].label}</span>
              </h2>
              <p className="bh-kaart-sub">
                {korteDatum(volgende.van)} t/m {korteDatum(volgende.tot)} · uiterlijk {langeDatum(volgende.deadline)} aangeven en betalen
                {volgende.status !== 'lopend' && (dagen >= 0 ? ` · nog ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}` : ` · ${-dagen} dagen te laat`)}
              </p>
            </div>
            <div className="bh-btw-volgende-bedrag">
              <span className="bh-btw-groot">{formatCenten(Math.abs(volgende.teBetalen))}</span>
              <span className="bh-kaart-sub">{bedragLabel(volgende.teBetalen)}{volgende.status === 'lopend' ? ' (tot nu toe)' : ''}</span>
            </div>
            <Link className="db-knop db-knop-primair bh-btw-volgende-knop" href={`/boekhouding/btw/${volgende.jaar}/${volgende.kwartaal}`}>
              Aangifte bekijken
            </Link>
          </section>
        )}

        <section className="bh-kaart" aria-labelledby="bh-btw-kwartalen">
          <header className="bh-kaart-kop">
            <h2 id="bh-btw-kwartalen" className="bh-kaart-titel">
              Kwartalen
            </h2>
            <p className="bh-kaart-sub">Factuurstelsel: de btw valt in het kwartaal van de factuur- of bondatum. Op het formulier in hele euro&apos;s, afgerond in je voordeel.</p>
          </header>
          <ul className="bh-kw-lijst">
            {rijen.map((r) => (
              <li key={`${r.jaar}-${r.kwartaal}`}>
                <Link className="bh-kw-rij" href={`/boekhouding/btw/${r.jaar}/${r.kwartaal}`}>
                  <span className="bh-kw-naam">{kwartaalLabel(r.jaar, r.kwartaal)}</span>
                  <span className="bh-kw-periode">
                    {korteDatum(r.van, false)} – {korteDatum(r.tot)}
                  </span>
                  <span className="bh-kw-status">
                    <span className={`bh-pil ${STATUS_LABEL[r.status].klasse}`}>{STATUS_LABEL[r.status].label}</span>
                    {r.afwijking && r.afwijking.advies !== 'geen' && <span className="bh-pil is-let-op">gewijzigd na indiening</span>}
                  </span>
                  <span className="bh-kw-deadline">{r.aangifte ? `ingediend ${korteDatum(r.aangifte.ingediendOp.slice(0, 10))}` : `uiterlijk ${korteDatum(r.deadline)}`}</span>
                  <span className="bh-kw-bedrag">
                    <span className={r.teBetalen < 0 ? 'is-bij' : ''}>{formatCenten(Math.abs(r.teBetalen))}</span>
                    <span className="bh-kw-bedrag-sub">{r.teBetalen < 0 ? 'terug' : r.teBetalen > 0 ? 'te betalen' : '—'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const bronLabel: Record<JournaalPost['bron'], string> = {
  boeking: 'Bank',
  factuur: 'Factuur',
  uitgave: 'Bonnetje',
  memoriaal: 'Memoriaal',
  beginsaldo: 'Beginsaldo',
  activum: 'Activum',
  afschrijving: 'Afschrijving',
  btw_afsluiting: 'Aangifte'
};

function postHref(p: JournaalPost): string | null {
  if (p.bron === 'boeking') return `/boekhouding/bank?jaar=alle&open=${p.bronId}`;
  if (p.bron === 'factuur') return `/facturen/${p.bronId}/bewerken`;
  if (p.bron === 'uitgave') return `/boekhouding/bonnetjes?uitgave=${p.bronId}`;
  if (p.bron === 'activum' || p.bron === 'afschrijving') return `/boekhouding/activa/${p.bronId}`;
  return null;
}

export async function AangifteScherm({ repo, jaar, kwartaal, eigenaar }: { repo: BoekhoudRepo; jaar: number; kwartaal: Kwartaal; eigenaar: boolean }) {
  const data = await laadAlles(repo);
  const vandaag = vandaagNL();
  const posten = journaalVan(data);
  const rijen = kwartalen(data, posten, vandaag);
  const rij =
    rijen.find((r) => r.jaar === jaar && r.kwartaal === kwartaal) ??
    ({
      jaar,
      kwartaal,
      ...kwartaalGrenzen(jaar, kwartaal),
      deadline: aangifteDeadline(jaar, kwartaal),
      status: kwartaalGrenzen(jaar, kwartaal).van > vandaag ? 'lopend' : 'te_doen',
      aangifte: data.aangiften.find((a) => a.jaar === jaar && a.kwartaal === kwartaal) ?? null,
      teBetalen: 0,
      betaald: 0,
      afwijking: null
    } satisfies KwartaalRij);
  const huidig = aangifteRubrieken(posten, jaar, kwartaal);

  // De posten achter de rubrieken (voor de doorklik), zonder de interne afleidingen.
  const ids = new Set(Object.values(huidig.posten).flat());
  const postRijen: Record<string, PostRij> = {};
  for (const p of posten) {
    if (!ids.has(p.id) || !p.btw) continue;
    const sub = p.bron === 'boeking' ? data.stam.rekeningen.find((r) => r.id === data.boekingen.find((b) => b.id === p.bronId)?.rekeningId)?.naam ?? 'Bank' : bronLabel[p.bron];
    postRijen[p.id] = { id: p.id, datum: p.datum, titel: p.omschrijving, bron: bronLabel[p.bron], sub, href: postHref(p), grondslag: p.btw.grondslag, verschuldigd: p.btw.verschuldigd, voorbelasting: p.btw.voorbelasting };
  }

  // Btw-betalingen: gekoppeld en voorstellen (bankregels "btw" na het kwartaal, nog niet gekoppeld).
  const naamBank = new Map(data.stam.rekeningen.map((r) => [r.id, r.naam]));
  const aangifte = rij.aangifte;
  const betalingen = aangifte
    ? data.aangifteBetalingen
        .filter((b) => b.aangifteId === aangifte.id)
        .flatMap((b) => {
          const bk = data.boekingen.find((x) => x.id === b.boekingId);
          return bk ? [{ id: b.id, boekingId: bk.id, datum: bk.datum, omschrijving: bk.omschrijving, bank: naamBank.get(bk.rekeningId ?? '') ?? 'Kas', bedrag: b.bedrag }] : [];
        })
    : [];
  const gekoppeldeBtw = new Set(data.aangifteBetalingen.map((b) => b.boekingId));
  const betaalSuggesties =
    aangifte && aangifte.teBetalen !== 0
      ? data.boekingen
          .filter((b) => b.soort === 'btw' && !gekoppeldeBtw.has(b.id) && b.datum > rij.tot && b.datum <= plusDagen(rij.deadline, 120) && b.richting === (aangifte.teBetalen > 0 ? 'af' : 'bij'))
          .map((b) => ({ boekingId: b.id, datum: b.datum, omschrijving: b.omschrijving, bank: naamBank.get(b.rekeningId ?? '') ?? 'Kas', bedrag: Math.abs(berekenBoeking(b).bankMutatie), exact: b.bedrag === Math.abs(aangifte.teBetalen) }))
          .sort((a, b) => Number(b.exact) - Number(a.exact) || (a.datum < b.datum ? -1 : 1))
          .slice(0, 4)
      : [];

  const vorige = rijen.find((r) => (r.jaar === jaar ? r.kwartaal === kwartaal - 1 : r.jaar === jaar - 1 && kwartaal === 1 && r.kwartaal === 4)) ?? null;
  const volgende = rijen.find((r) => (r.jaar === jaar ? r.kwartaal === kwartaal + 1 : r.jaar === jaar + 1 && kwartaal === 4 && r.kwartaal === 1)) ?? null;

  const view: AangifteView = {
    jaar,
    kwartaal,
    van: rij.van,
    tot: rij.tot,
    deadline: rij.deadline,
    status: rij.status,
    vandaag,
    huidig,
    aangifte,
    afwijking: rij.afwijking,
    betaald: rij.betaald,
    posten: postRijen,
    controles: btwControles({ jaar, kwartaal, vandaag, boekingen: data.boekingen, facturen: data.facturen, uitgaven: data.uitgaven, koppelingen: data.koppelingen, bronExtra: data.bronExtra, kwartalen: rijen }),
    betalingen,
    betaalSuggesties,
    eigenaar,
    jaarDicht: data.stam.vergrendeling.boekjaren.includes(jaar),
    kor: data.stam.instellingen.kor,
    vorige: vorige ? { jaar: vorige.jaar, kwartaal: vorige.kwartaal } : null,
    volgende: volgende ? { jaar: volgende.jaar, kwartaal: volgende.kwartaal } : null
  };

  return (
    <div className="bh">
      <BoekhoudingKop titel={`Btw-aangifte ${kwartaalLabel(jaar, kwartaal)}`} />
      <Demo repo={repo} />
      <AangifteApp view={view} />
    </div>
  );
}
