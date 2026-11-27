'use client';

import { useCallback, useEffect, useState } from 'react';
import { ToastProvider, useToast } from '@/components/agenda/Toast';
import { PLATFORM_LABEL, formatGepland } from '@/lib/social/kern';
import type { AccountDto, AccountsAntwoord } from '@/lib/social/types';
import { api, foutTekst } from './api';
import { PlatformIcoon } from './Iconen';

// Meldingen bij ?fout=<code> na het koppelen (app/api/social/meta/callback).
const KOPPEL_FOUTEN: Record<string, string> = {
  geweigerd: 'Koppelen afgebroken: je gaf Meta geen toestemming.',
  ongeldig: 'Koppelen is verlopen of ongeldig. Probeer het opnieuw.',
  scope: 'Niet alle rechten zijn aangevinkt. Koppel opnieuw en laat alle vinkjes aan.',
  geen_paginas: 'Er is geen Facebookpagina gevonden waar je beheerder van bent.',
  geen_rechten: 'Je account heeft niet genoeg rechten op de pagina (je moet beheerder zijn).',
  niet_ingericht: 'Meta is nog niet ingericht op de server (META_APP_ID en META_APP_SECRET).',
  tabel_ontbreekt: 'Voer eerst migratie 0041 uit (supabase/UITVOEREN_0041.sql).',
  meta: 'Meta gaf een fout. Probeer het over een paar minuten opnieuw.',
  fout: 'Koppelen is niet gelukt. Probeer het opnieuw.'
};

// Koppelingen: de gekoppelde Instagram-accounts en Facebookpagina's, koppelen met Meta,
// opnieuw koppelen, ontkoppelen en nu synchroniseren. De tokens blijven op de server; deze
// pagina ziet alleen AccountDto's (GET /api/social/accounts).
export function Koppelingen(props: { gekoppeld: string | null; fout: string | null }) {
  return (
    <ToastProvider>
      <KoppelingenInhoud {...props} />
    </ToastProvider>
  );
}

function KoppelingenInhoud({ gekoppeld, fout: koppelFout }: { gekoppeld: string | null; fout: string | null }) {
  const toast = useToast();
  const [data, setData] = useState<AccountsAntwoord | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);

  const laad = useCallback(async () => {
    try {
      setData(await api<AccountsAntwoord>('/api/social/accounts'));
      setFout(null);
    } catch (e) {
      setFout(foutTekst(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- eerste keer ophalen
    void laad();
  }, [laad]);

  // Melding na de terugkeer van Meta, en de query daarna weg uit de adresbalk.
  useEffect(() => {
    if (gekoppeld) toast(Number(gekoppeld) === 1 ? '1 account gekoppeld.' : `${Number(gekoppeld) || 0} accounts gekoppeld.`);
    else if (koppelFout) toast(KOPPEL_FOUTEN[koppelFout] ?? KOPPEL_FOUTEN.fout, { fout: true, duur: 9000 });
    if (gekoppeld || koppelFout) window.history.replaceState(null, '', '/social/koppelingen');
  }, [gekoppeld, koppelFout, toast]);

  async function ontkoppel(a: AccountDto) {
    if (!window.confirm(`${a.naam} (${PLATFORM_LABEL[a.platform]}) ontkoppelen? Ingeplande posts voor dit account worden dan niet meer geplaatst; de cijfers van dit account verdwijnen uit Analytics.`)) return;
    setBezig(a.id);
    try {
      await api(`/api/social/accounts/${a.id}`, { method: 'DELETE' });
      toast('Ontkoppeld.');
      await laad();
    } catch (e) {
      toast(foutTekst(e), { fout: true });
    } finally {
      setBezig(null);
    }
  }

  async function synchroniseer() {
    setBezig('sync');
    try {
      const r = await api<{ nieuw?: number; inzichten?: number; fouten?: string[] }>('/api/social/sync', { method: 'POST' });
      if (r.fouten?.length) toast(r.fouten[0], { fout: true, duur: 8000 });
      else toast(`Gesynchroniseerd: ${r.nieuw ?? 0} nieuwe posts, ${r.inzichten ?? 0} cijferregels bijgewerkt.`);
      await laad();
    } catch (e) {
      toast(foutTekst(e), { fout: true });
    } finally {
      setBezig(null);
    }
  }

  const accounts = data?.accounts ?? [];
  const ingericht = data?.ingericht ?? false;

  return (
    <div className="so-inhoud so-smal">
      {data?.melding && (
        <p className="so-melding" role="status">
          <strong>Social is nog niet ingericht.</strong> {data.melding}
        </p>
      )}
      {data && !data.melding && !ingericht && (
        <p className="so-melding" role="status">
          <strong>Koppelen met Meta is nog niet ingericht.</strong> Zet META_APP_ID, META_APP_SECRET en de versleutelsleutel in de omgevingsvariabelen van de
          server (zie README, “Social media”).
        </p>
      )}
      {fout && (
        <p className="so-melding" role="alert">
          {fout}{' '}
          <button type="button" className="ag-link-knop" onClick={() => void laad()}>
            Opnieuw
          </button>
        </p>
      )}

      <section className="db-kaart" aria-label="Gekoppelde accounts">
        <header className="db-kaart-kop">
          <h2 className="db-label">Gekoppelde accounts</h2>
          {accounts.length > 0 && (
            <button type="button" className="db-knop" onClick={() => void synchroniseer()} disabled={bezig !== null || !ingericht}>
              {bezig === 'sync' ? 'Synchroniseren…' : 'Nu synchroniseren'}
            </button>
          )}
        </header>
        <div className="db-kaart-inhoud">
          {!data && !fout ? (
            <div className="db-skelet" />
          ) : accounts.length === 0 ? (
            <p className="so-zacht">Nog niets gekoppeld.</p>
          ) : (
            <ul className="so-koppellijst">
              {accounts.map((a) => {
                const probleem = !a.actief || !!a.fout;
                return (
                  <li key={a.id} className={probleem ? 'is-probleem' : ''}>
                    <span className="so-account-foto" aria-hidden="true">
                      {a.afbeelding_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- profielfoto van Meta
                        <img src={a.afbeelding_url} alt="" />
                      ) : (
                        <PlatformIcoon platform={a.platform} grootte={16} />
                      )}
                      <span className="so-account-platform">
                        <PlatformIcoon platform={a.platform} grootte={10} />
                      </span>
                    </span>
                    <span className="so-account-tekst">
                      <strong>{a.naam || a.gebruikersnaam}</strong>
                      <span className="so-zacht">
                        {PLATFORM_LABEL[a.platform]}
                        {a.gebruikersnaam ? ` · @${a.gebruikersnaam}` : ''}
                        {a.laatst_gesynct_op ? ` · gesynchroniseerd ${formatGepland(a.laatst_gesynct_op)}` : ''}
                      </span>
                      {probleem ? (
                        <span className="so-fouttekst">{a.fout === 'opnieuw_koppelen' || !a.fout ? 'De toegang is verlopen of ingetrokken: koppel opnieuw.' : a.fout}</span>
                      ) : a.token_verloopt_op ? (
                        <span className="so-zacht">Toegang geldig tot {formatGepland(a.token_verloopt_op)}</span>
                      ) : null}
                    </span>
                    <span className="so-koppel-acties">
                      {probleem && ingericht && (
                        <a className="db-knop db-knop-primair" href="/api/social/meta/start">
                          Opnieuw koppelen
                        </a>
                      )}
                      <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => void ontkoppel(a)} disabled={bezig !== null}>
                        Ontkoppelen
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            {ingericht ? (
              <a className={`db-knop${accounts.length ? '' : ' db-knop-primair'}`} href="/api/social/meta/start">
                {accounts.length ? 'Nog een account koppelen' : 'Koppelen met Meta'}
              </a>
            ) : (
              <button type="button" className="db-knop" disabled>
                Koppelen met Meta
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="db-kaart" aria-label="Wat is er nodig">
        <header className="db-kaart-kop">
          <h2 className="db-label">Wat is er nodig</h2>
        </header>
        <div className="db-kaart-inhoud so-uitleg">
          <ol>
            <li>
              Een <strong>zakelijk Instagram-account</strong> (of makersaccount). Persoonlijke accounts kunnen niet via Meta plaatsen; omzetten kan gratis in de
              Instagram-app onder Instellingen → Accounttype.
            </li>
            <li>
              Dat Instagram-account is <strong>gekoppeld aan een Facebookpagina</strong> (Instagram → Instellingen → Accountcentrum, of in Meta Business Suite).
            </li>
            <li>
              Jij bent <strong>beheerder van die Facebookpagina</strong>. Klik op “Koppelen met Meta”, log in bij Facebook en laat alle vinkjes aan; kies de
              pagina&apos;s en Instagram-accounts die het dashboard mag gebruiken.
            </li>
          </ol>
          <p className="so-zacht">
            Daarna worden ingeplande posts vanzelf geplaatst (elke 5 minuten wordt gecontroleerd wat aan de beurt is) en haalt het dashboard regelmatig je posts en
            cijfers op, ook van posts die je in de app zelf plaatst. Verloopt de toegang of trek je hem in bij Facebook, dan staat hier dat je opnieuw moet
            koppelen.
          </p>
        </div>
      </section>
    </div>
  );
}
