'use client';

import { useId, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { ModuleKop } from '@/components/shell/ModuleKop';
import { initialenUit, KLEUREN, valideerProfiel, type ProfielInvoer } from '@/lib/account/types';
import type { MailboxenOverzicht } from '@/lib/mail/beheer';
import { Mailboxen } from './Mailboxen';
import { BeveiligingAccount, type BeveiligingAccountData } from '@/components/beveiliging/BeveiligingAccount';

type Melding = { soort: 'ok' | 'fout'; tekst: string } | null;

async function verstuur<T>(url: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
  } catch {
    throw new Error('Geen verbinding. Controleer je internet en probeer het opnieuw.');
  }
  if (res.status === 401) {
    window.location.href = '/login?next=/account';
    throw new Error('Je bent uitgelogd.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Er ging iets mis.');
  return data as T;
}

export function AccountApp({
  email,
  rol,
  overgang,
  profiel,
  mailboxen,
  beveiliging
}: {
  email: string;
  rol: 'eigenaar' | 'lid';
  overgang: boolean;
  profiel: ProfielInvoer;
  mailboxen: MailboxenOverzicht | null;
  beveiliging: BeveiligingAccountData;
}) {
  return (
    <div className="ac">
      <ModuleKop label="Account" titel="Account & mail" />
      <div className="ac-inhoud">
        <ProfielBlok email={email} rol={rol} overgang={overgang} start={profiel} />
        <Mailboxen start={mailboxen} email={email} />
        <BeveiligingAccount data={beveiliging} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Profiel
// ---------------------------------------------------------------------------------
function ProfielBlok({ email, rol, overgang, start }: { email: string; rol: string; overgang: boolean; start: ProfielInvoer }) {
  const router = useRouter();
  const id = useId();
  const [p, setP] = useState(start);
  const [opgeslagen, setOpgeslagen] = useState(start);
  const [initialenZelf, setInitialenZelf] = useState(start.initialen !== initialenUit(start.naam));
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<Melding>(null);
  const gewijzigd = p.naam !== opgeslagen.naam || p.initialen !== opgeslagen.initialen || p.kleur !== opgeslagen.kleur;
  const kleuren = KLEUREN.some((k) => k.kleur === start.kleur) ? KLEUREN : [{ kleur: start.kleur, naam: 'Huidig' }, ...KLEUREN];

  async function opslaan(e: React.FormEvent) {
    e.preventDefault();
    const v = valideerProfiel(p);
    if (!v.ok) {
      setMelding({ soort: 'fout', tekst: v.fout });
      return;
    }
    setBezig(true);
    setMelding(null);
    try {
      await verstuur('/api/account/profiel', 'PATCH', v.waarde);
      setP(v.waarde);
      setOpgeslagen(v.waarde);
      setMelding({ soort: 'ok', tekst: 'Profiel opgeslagen.' });
      router.refresh(); // rail en begroeting bijwerken
    } catch (err) {
      setMelding({ soort: 'fout', tekst: err instanceof Error ? err.message : 'Opslaan mislukt.' });
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="ac-blok" aria-labelledby={`${id}-titel`}>
      <header className="ac-blok-kop">
        <h2 id={`${id}-titel`} className="ac-blok-titel">Profiel</h2>
        <p className="ac-blok-uitleg">Zo zien je teamgenoten je bij taken, uploads en facturen.</p>
      </header>
      <form className="ac-profiel" onSubmit={opslaan}>
        <div className="ac-voorbeeld" aria-hidden="true">
          <span className="ac-avatar" style={{ '--sl-avatar-kleur': p.kleur } as CSSProperties}>
            {p.initialen || '?'}
          </span>
          <span className="ac-voorbeeld-tekst">
            <strong>{p.naam || 'Je naam'}</strong>
            <span>
              {email} · {rol === 'eigenaar' ? 'eigenaar' : 'teamlid'}
            </span>
          </span>
        </div>
        <div className="ac-velden">
          <label className="ag-label">
            Naam
            <input
              className="ag-veld"
              value={p.naam}
              maxLength={80}
              autoComplete="name"
              disabled={overgang}
              onChange={(e) => {
                const naam = e.target.value;
                setP((x) => ({ ...x, naam, initialen: initialenZelf ? x.initialen : initialenUit(naam).slice(0, 3) }));
              }}
            />
          </label>
          <label className="ag-label ac-smal">
            Initialen
            <input
              className="ag-veld"
              value={p.initialen}
              maxLength={3}
              autoCapitalize="characters"
              disabled={overgang}
              onChange={(e) => {
                setInitialenZelf(true);
                setP((x) => ({ ...x, initialen: e.target.value.toUpperCase().replace(/[^\p{L}]/gu, '').slice(0, 3) }));
              }}
            />
          </label>
        </div>
        <fieldset className="ac-kleuren" disabled={overgang}>
          <legend className="ac-legend">Kleur</legend>
          {kleuren.map((k) => (
            <label key={k.kleur} className="ac-kleur" title={k.naam}>
              <input
                type="radio"
                name={`${id}-kleur`}
                value={k.kleur}
                checked={p.kleur === k.kleur}
                onChange={() => setP((x) => ({ ...x, kleur: k.kleur }))}
              />
              <span className="ac-kleur-stip" style={{ background: k.kleur }} aria-hidden="true" />
              <span className="sr-only">{k.naam}</span>
            </label>
          ))}
        </fieldset>
        {overgang ? (
          <p className="ag-uitleg">Je profiel aanpassen kan zodra de teambeveiliging actief is (migratie 0021).</p>
        ) : (
          <div className="ac-acties">
            <button type="submit" className="db-knop db-knop-primair" disabled={bezig || !gewijzigd}>
              {bezig ? 'Opslaan…' : 'Profiel opslaan'}
            </button>
            <MeldingTekst melding={melding} />
          </div>
        )}
      </form>
    </section>
  );
}

function MeldingTekst({ melding }: { melding: Melding }) {
  if (!melding) return <span aria-live="polite" />;
  return (
    <p className={melding.soort === 'fout' ? 'ag-fout' : 'ac-ok'} role={melding.soort === 'fout' ? 'alert' : 'status'}>
      {melding.tekst}
    </p>
  );
}
