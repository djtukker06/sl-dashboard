'use client';

import { useState } from 'react';
import { adresNaam, bijlageUrl, grootteTekst, initialen, lijstDatum, volleDatum } from '@/lib/mail/client';
import type { Adres, GesprekBericht } from '@/lib/mail/types';
import { Icoon } from './Iconen';
import { TekstMail } from './Lezer';

// De andere berichten uit hetzelfde gesprek, zoals Gmail een chain toont: elk bericht een
// ingeklapte regel (gekleurde avatar, afzender, begin van de tekst, datum) die je openklapt
// tot de volledige tekst. Een lange reeks eerdere berichten wordt in het midden samengevat
// ("5 eerdere berichten") tot je daarop klikt. Geciteerde geschiedenis zit achter "•••".

/** Hooguit zoveel eerdere berichten zonder samenvatting; daarboven: eerste + laatste twee. */
const MAX_ZICHTBAAR = 4;

/** Vaste kleur per afzender (hash van het adres), zodat dezelfde persoon steeds dezelfde kleur heeft. */
export function avatarKleur(a: Adres | null | undefined): string {
  const bron = (a?.adres || a?.naam || '?').toLowerCase();
  let h = 0;
  for (let i = 0; i < bron.length; i++) h = (h * 31 + bron.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 42% 44%)`;
}

export function GekleurdeAvatar({ adres, klein }: { adres: Adres | null | undefined; klein?: boolean }) {
  return (
    <span
      className={`ml-avatar ml-avatar-kleur${klein ? ' ml-avatar-klein' : ''}`}
      style={{ '--ml-avatar-kleur': avatarKleur(adres) } as React.CSSProperties}
      aria-hidden="true"
    >
      {initialen(adres)}
    </span>
  );
}

function fragment(tekst: string): string {
  return tekst.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function Kaart({ mb, b }: { mb: string; b: GesprekBericht }) {
  const [open, setOpen] = useState(false);
  const [citaat, setCitaat] = useState(false);
  const naam = b.verzonden ? 'Ik' : adresNaam(b.van);
  return (
    <li className={`ml-gesprek-kaart${open ? ' ml-open' : ''}`}>
      <button type="button" className="ml-gesprek-kop" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <GekleurdeAvatar adres={b.van} />
        <span className="ml-gesprek-wie">
          <span className="ml-gesprek-naamregel">
            <strong>{naam}</strong>
            {open && b.van?.adres && <span className="ml-lezer-adres">{b.van.adres}</span>}
          </span>
          {open ? (
            b.aan.length > 0 && (
              <span className="ml-gesprek-sub">aan {b.aan.map((a) => a.naam || a.adres).join(', ')}</span>
            )
          ) : (
            <span className="ml-gesprek-sub">{fragment(b.tekst) || '(geen tekst)'}</span>
          )}
        </span>
        <span className="ml-gesprek-rechts">
          {b.bijlagen.length > 0 && <Icoon naam="clip" grootte={14} className="ml-icoon" />}
          <time dateTime={b.datum ?? undefined} title={volleDatum(b.datum)}>
            {open ? volleDatum(b.datum) : lijstDatum(b.datum)}
          </time>
        </span>
      </button>
      {open && (
        <div className="ml-gesprek-inhoud">
          {b.tekst ? <TekstMail tekst={b.tekst} /> : <p className="ml-tekst ml-leeg-tekst">(Dit bericht heeft geen tekst.)</p>}
          {b.citaat && (
            <>
              <button
                type="button"
                className="ml-gesprek-citaat-knop"
                aria-expanded={citaat}
                title={citaat ? 'Geciteerde tekst verbergen' : 'Geciteerde tekst tonen'}
                aria-label={citaat ? 'Geciteerde tekst verbergen' : 'Geciteerde tekst tonen'}
                onClick={() => setCitaat((c) => !c)}
              >
                •••
              </button>
              {citaat && (
                <div className="ml-gesprek-citaat">
                  <TekstMail tekst={b.citaat} />
                </div>
              )}
            </>
          )}
          {b.bijlagen.length > 0 && (
            <ul className="ml-bijlagen ml-gesprek-bijlagen" aria-label="Bijlagen">
              {b.bijlagen.map((x) => (
                <li key={x.deel}>
                  <a className="ml-bijlage" href={bijlageUrl(mb, b.map, b.uid, x.deel)} download={x.naam} title={`${x.naam} downloaden`}>
                    <Icoon naam={x.type.startsWith('image/') ? 'beeld' : 'bestand'} grootte={16} />
                    <span className="ml-bijlage-naam">{x.naam}</span>
                    <span className="ml-bijlage-grootte">{grootteTekst(x.grootte)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function GesprekLijst({
  mb,
  berichten,
  label,
  samenvatten = false
}: {
  /** De inbox (voor de download-links van bijlagen). */
  mb: string;
  berichten: GesprekBericht[];
  label: string;
  samenvatten?: boolean;
}) {
  const [alles, setAlles] = useState(false);
  if (!berichten.length) return null;

  const inklappen = samenvatten && !alles && berichten.length > MAX_ZICHTBAAR;
  const verborgen = inklappen ? berichten.length - 3 : 0;
  return (
    <ol className="ml-gesprek-lijst" aria-label={label}>
      {(inklappen ? berichten.slice(0, 1) : berichten).map((b) => (
        <Kaart key={`${b.map}:${b.uid}`} mb={mb} b={b} />
      ))}
      {inklappen && (
        <>
          <li className="ml-gesprek-meer">
            <button type="button" onClick={() => setAlles(true)}>
              <span className="ml-gesprek-meer-rondje">{verborgen}</span>
              <span>{verborgen === 1 ? '1 eerder bericht' : `${verborgen} eerdere berichten`}</span>
            </button>
          </li>
          {berichten.slice(-2).map((b) => (
            <Kaart key={`${b.map}:${b.uid}`} mb={mb} b={b} />
          ))}
        </>
      )}
    </ol>
  );
}
