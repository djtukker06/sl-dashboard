import 'server-only';
import { BoekhoudingKop } from './BoekhoudingKop';
import { Demo, type Zoekparams } from './Schermen';
import { ActivaApp, type ActivaRij, type Voorstel } from './ActivaApp';
import { ActivumDetail } from './ActivumDetail';
import type { ActiveerBron } from './ActivumFormulier';
import { ACTIVA_KIESBAAR } from '@/lib/boekhouding/kern/constanten';
import { jaarVan, maakDatum, vandaagNL } from '@/lib/boekhouding/kern/periode';
import {
  activastaat,
  activumVergrendelFout,
  boekresultaat,
  boekwaardeBijDesinvestering,
  boekwaardeOp,
  cumulatiefOp,
  maandbedrag,
  perJaar,
  schema,
  type Activum
} from '@/lib/boekhouding/kern/afschrijving';
import { activaControles, boekingExcl, teActiveren, type ActiveerContext } from '@/lib/boekhouding/kern/activeren';
import { isVergrendeld } from '@/lib/boekhouding/kern/periode';
import { laadAlles, type BoekhoudData, type BoekhoudRepo } from '@/lib/boekhouding/repo/types';

// De activaschermen: de activastaat per jaar met voorstellen om te activeren, en één activum
// met het afschrijvingsschema en desinvestering.

const een = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function ctxVan(d: BoekhoudData): ActiveerContext {
  return { boekingen: d.boekingen, uitgaven: d.uitgaven, koppelingen: d.koppelingen, bronExtra: d.bronExtra, activa: d.activa };
}

function herkomstVan(a: Activum, d: BoekhoudData): { label: string; href: string | null } {
  if (a.boekingId) {
    const b = d.boekingen.find((x) => x.id === a.boekingId);
    const bank = b ? d.stam.rekeningen.find((r) => r.id === b.rekeningId)?.naam ?? 'Bank' : 'Bank';
    return b ? { label: `${bank}: ${b.omschrijving}`, href: `/boekhouding/bank?jaar=alle&open=${b.id}` } : { label: 'Bankregel bestaat niet meer', href: null };
  }
  if (a.uitgaveId) {
    const u = d.uitgaven.find((x) => x.id === a.uitgaveId);
    return u ? { label: `Bonnetje ${u.leverancier || u.omschrijving || ''}`.trim(), href: `/boekhouding/bonnetjes?uitgave=${u.id}` } : { label: 'Bonnetje bestaat niet meer', href: null };
  }
  return { label: 'Ingebracht / al in bezit', href: null };
}

export async function ActivaScherm({ repo, sp, demoReden }: { repo: BoekhoudRepo; sp: Zoekparams; demoReden: 'env' | 'migratie' }) {
  const data = await laadAlles(repo);
  const vandaag = vandaagNL();
  const nu = jaarVan(vandaag);
  const vroegst = Math.min(nu, ...data.activa.map((a) => jaarVan(a.aanschafdatum)));
  const jaren = Array.from({ length: Math.min(12, nu - vroegst + 1) }, (_, i) => nu - i);
  const gevraagd = Number(een(sp.jaar));
  const jaar = jaren.includes(gevraagd) ? gevraagd : nu;
  const ctx = ctxVan(data);
  const controles = new Map(activaControles(ctx).map((c) => [c.activumId, c.tekst]));
  const staat = activastaat(data.activa, jaar);
  const eindJaar = maakDatum(jaar, 12, 31);
  const rijen: ActivaRij[] = staat.regels.map((r) => {
    const a = r.activum;
    const basis = a.aanschaf - a.restwaarde;
    const status: ActivaRij['status'] =
      a.desinvesteringDatum && a.desinvesteringDatum <= eindJaar ? 'gedesinvesteerd' : a.ingebruikname > eindJaar ? 'nog_niet' : boekwaardeOp(a, eindJaar) <= a.restwaarde ? 'afgeschreven' : 'in_gebruik';
    return { ...r, status, herkomst: herkomstVan(a, data).label, voortgang: basis ? Math.min(1, cumulatiefOp(a, eindJaar) / basis) : 1, controle: controles.get(a.id) ?? null };
  });
  const voorstellen: Voorstel[] = teActiveren(ctx).map((v) => ({ ...v, excl: v.excl - v.geactiveerd, opActiva: v.grootboek !== null && ACTIVA_KIESBAAR.has(v.grootboek) }));

  // ?activeer=boeking:<id> of uitgave:<id>: het paneel direct open met die aankoop.
  let activeer: ActiveerBron | null = null;
  const m = /^(boeking|uitgave):([0-9a-f-]{36})$/i.exec(een(sp.activeer));
  if (m) activeer = voorstellen.find((v) => v.soort === m[1] && v.id === m[2]) ?? null;
  if (!activeer && m) {
    const b = m[1] === 'boeking' ? data.boekingen.find((x) => x.id === m[2] && x.soort === 'uitgave') : null;
    if (b) activeer = { soort: 'boeking', id: b.id, titel: b.omschrijving, datum: b.datum, excl: Math.max(0, boekingExcl(b) - data.activa.filter((a) => a.boekingId === b.id).reduce((t, a) => t + a.aanschaf, 0)) };
  }

  return (
    <div className="bh">
      <BoekhoudingKop titel="Activa & afschrijvingen" />
      <Demo repo={repo} reden={demoReden} />
      <ActivaApp jaar={jaar} jaren={jaren} rijen={rijen} totaal={staat.totaal} voorstellen={voorstellen} vandaag={vandaag} activeer={activeer} />
    </div>
  );
}

export async function ActivumScherm({ repo, id, demoReden }: { repo: BoekhoudRepo; id: string; demoReden: 'env' | 'migratie' }) {
  const data = await laadAlles(repo);
  const a = data.activa.find((x) => x.id === id);
  if (!a) return null;
  const vandaag = vandaagNL();
  const v = data.stam.vergrendeling;
  const slot = activumVergrendelFout(a, null, { boekjaren: v.boekjaren, open: (d) => !isVergrendeld(d, v) });
  const controle = activaControles(ctxVan(data)).find((c) => c.activumId === a.id)?.tekst ?? null;
  return (
    <div className="bh">
      <BoekhoudingKop titel="Activa & afschrijvingen" />
      <Demo repo={repo} reden={demoReden} />
      <ActivumDetail
        view={{
          activum: a,
          vandaag,
          boekwaardeNu: boekwaardeOp(a, vandaag),
          perMaand: maandbedrag(a).gewoon,
          schema: schema(a),
          perJaar: perJaar(a),
          herkomst: herkomstVan(a, data),
          boekwaardeBijDesinvestering: boekwaardeBijDesinvestering(a),
          boekresultaat: boekresultaat(a),
          slot,
          controle
        }}
      />
    </div>
  );
}
