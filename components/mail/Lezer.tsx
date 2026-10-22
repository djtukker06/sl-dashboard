'use client';

import { Fragment, useState } from 'react';
import { adresNaam, bijlageUrl, downloadBijlage, grootteTekst, initialen, MailApiFout, volleDatum } from '@/lib/mail/client';
import { useToast } from '@/components/agenda/Toast';
import type { Adres, Bericht, MapRol } from '@/lib/mail/types';
import { Icoon, type MailIcoonNaam } from './Iconen';
import { VeiligeMailFrame } from './VeiligeMailFrame';

export type LezerActie =
  | 'antwoord'
  | 'allen'
  | 'doorsturen'
  | 'archief'
  | 'prullenbak'
  | 'inbox'
  | 'ongelezen'
  | 'vlag'
  | 'taak';

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|([\w.+-]+@[\w-]+\.[\w.-]+\w)/g;

/** Platte tekst met klikbare links (React escapet de rest). Geciteerde regels ("> ") gedimd. */
function TekstMail({ tekst }: { tekst: string }) {
  const regels = tekst.split('\n');
  return (
    <div className="ml-tekst">
      {regels.map((regel, i) => {
        const delen: React.ReactNode[] = [];
        let laatste = 0;
        for (const m of regel.matchAll(URL_RE)) {
          const start = m.index ?? 0;
          if (start > laatste) delen.push(regel.slice(laatste, start));
          const waarde = m[0];
          const href = m[1] ? waarde : `mailto:${waarde}`;
          delen.push(
            <a key={start} href={href} target="_blank" rel="noopener noreferrer">
              {waarde}
            </a>
          );
          laatste = start + waarde.length;
        }
        if (laatste < regel.length) delen.push(regel.slice(laatste));
        const citaat = /^\s*>/.test(regel);
        return (
          <Fragment key={i}>
            {citaat ? <span className="ml-tekst-citaat">{delen}</span> : delen}
            {'\n'}
          </Fragment>
        );
      })}
    </div>
  );
}

function AdresRegel({ label, adressen }: { label: string; adressen: Adres[] }) {
  if (!adressen.length) return null;
  return (
    <p className="ml-lezer-regel">
      <span className="ml-lezer-regel-label">{label}</span>
      <span>
        {adressen.map((a, i) => (
          <Fragment key={`${a.adres}-${i}`}>
            {i > 0 && ', '}
            <span title={a.adres}>{a.naam || a.adres}</span>
          </Fragment>
        ))}
      </span>
    </p>
  );
}

function ActieKnop({
  icoon,
  label,
  toets,
  onClick,
  aan
}: {
  icoon: MailIcoonNaam;
  label: string;
  toets?: string;
  onClick: () => void;
  aan?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ml-actie${aan ? ' ml-aan' : ''}`}
      onClick={onClick}
      title={toets ? `${label} (${toets})` : label}
      aria-pressed={aan === undefined ? undefined : aan}
    >
      <Icoon naam={icoon} grootte={17} />
      <span className="ml-actie-label">{label}</span>
    </button>
  );
}

export function Lezer({
  bericht,
  rol,
  laden,
  fout,
  gemarkeerd,
  smal,
  onActie,
  onTerug,
  onOpnieuw
}: {
  bericht: Bericht | null;
  rol: MapRol;
  laden: boolean;
  fout: MailApiFout | null;
  gemarkeerd: boolean;
  smal: boolean;
  onActie: (a: LezerActie) => void;
  onTerug: () => void;
  onOpnieuw: () => void;
}) {
  // Per bericht opnieuw geblokkeerd: de sleutel van de component is map+uid (zie MailApp).
  const [beelden, setBeelden] = useState(false);
  const [downloadt, setDownloadt] = useState<string | null>(null);
  const toast = useToast();

  async function download(e: React.MouseEvent<HTMLAnchorElement>, map: string, uid: number, deel: string, naam: string) {
    // Gewone klik via fetch (fout als melding); met modifier-toetsen de browser laten doen.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (downloadt) return;
    setDownloadt(deel);
    try {
      await downloadBijlage(bijlageUrl(map, uid, deel), naam);
    } catch (err) {
      toast(err instanceof MailApiFout ? err.message : 'Downloaden van de bijlage is mislukt.', { fout: true });
    } finally {
      setDownloadt(null);
    }
  }

  if (!bericht) {
    return (
      <section className="ml-lezer ml-lezer-leeg" aria-label="Leesvenster">
        {smal && (
          <button type="button" className="ml-terug" onClick={onTerug}>
            <Icoon naam="terug" grootte={16} /> Terug
          </button>
        )}
        {fout ? (
          <div className="ml-leeg" role="alert">
            <p className="ml-leeg-titel ml-fout">{fout.message}</p>
            <button type="button" className="db-knop" onClick={onOpnieuw}>
              Opnieuw
            </button>
          </div>
        ) : laden ? (
          <div className="ml-lezer-skelet" aria-busy="true" aria-label="Bericht laden">
            <div className="db-skelet db-skelet-groot" />
            <div className="db-skelet" style={{ width: '40%' }} />
            <div className="db-skelet" style={{ width: '30%' }} />
            <div className="ml-lezer-skelet-vlak" />
          </div>
        ) : (
          <div className="ml-leeg ml-leeg-groot">
            <Icoon naam="inbox" grootte={30} className="ml-icoon ml-leeg-icoon" />
            <p className="ml-leeg-titel">Kies een bericht om te lezen</p>
            <p className="ml-leeg-tekst">
              <kbd>j</kbd> <kbd>k</kbd> volgende/vorige · <kbd>r</kbd> beantwoorden · <kbd>e</kbd> archiveren ·{' '}
              <kbd>c</kbd> nieuwe mail · <kbd>/</kbd> zoeken
            </p>
          </div>
        )}
      </section>
    );
  }

  const b = bericht;
  return (
    <section className="ml-lezer" aria-label="Leesvenster">
      <div className="ml-acties" role="toolbar" aria-label="Acties voor dit bericht">
        {smal && (
          <button type="button" className="ml-actie ml-actie-terug" onClick={onTerug} aria-label="Terug naar de lijst">
            <Icoon naam="terug" grootte={17} />
          </button>
        )}
        <ActieKnop icoon="antwoord" label="Beantwoorden" toets="r" onClick={() => onActie('antwoord')} />
        <ActieKnop icoon="allen" label="Allen" toets="a" onClick={() => onActie('allen')} />
        <ActieKnop icoon="doorsturen" label="Doorsturen" toets="f" onClick={() => onActie('doorsturen')} />
        <span className="ml-acties-scheiding" aria-hidden="true" />
        {rol === 'prullenbak' || rol === 'spam' || rol === 'archief' ? (
          <ActieKnop icoon="inbox" label={rol === 'spam' ? 'Geen spam' : 'Naar inbox'} onClick={() => onActie('inbox')} />
        ) : (
          <ActieKnop icoon="archief" label="Archiveren" toets="e" onClick={() => onActie('archief')} />
        )}
        {rol !== 'prullenbak' && <ActieKnop icoon="prullenbak" label="Verwijderen" toets="#" onClick={() => onActie('prullenbak')} />}
        <ActieKnop icoon="ongelezen" label="Ongelezen" toets="u" onClick={() => onActie('ongelezen')} />
        <ActieKnop icoon="vlag" label="Markeren" toets="s" aan={gemarkeerd} onClick={() => onActie('vlag')} />
        <span className="ml-acties-scheiding" aria-hidden="true" />
        <ActieKnop icoon="taak" label="Taak maken" toets="t" onClick={() => onActie('taak')} />
      </div>

      <div className="ml-lezer-scroll">
        <header className="ml-lezer-kop">
          <h2 className="ml-lezer-onderwerp">{b.onderwerp || '(geen onderwerp)'}</h2>
          <div className="ml-lezer-afzender">
            <span className="ml-avatar" aria-hidden="true">
              {initialen(b.van)}
            </span>
            <div className="ml-lezer-wie">
              <p className="ml-lezer-van">
                <strong>{adresNaam(b.van)}</strong>
                {b.van?.adres && b.van.naam && <span className="ml-lezer-adres">{b.van.adres}</span>}
              </p>
              <AdresRegel label="Aan" adressen={b.aan} />
              <AdresRegel label="Cc" adressen={b.cc} />
            </div>
            <time className="ml-lezer-datum" dateTime={b.datum ?? undefined}>
              {volleDatum(b.datum)}
            </time>
          </div>
        </header>

        {b.bijlagen.length > 0 && (
          <ul className="ml-bijlagen" aria-label="Bijlagen">
            {b.bijlagen.map((x) => (
              <li key={x.deel}>
                <a
                  className="ml-bijlage"
                  href={bijlageUrl(b.map, b.uid, x.deel)}
                  download={x.naam}
                  title={`${x.naam} downloaden`}
                  aria-busy={downloadt === x.deel || undefined}
                  onClick={(e) => download(e, b.map, b.uid, x.deel, x.naam)}
                >
                  <Icoon naam={x.type.startsWith('image/') ? 'beeld' : 'bestand'} grootte={16} />
                  <span className="ml-bijlage-naam">{x.naam}</span>
                  <span className="ml-bijlage-grootte">{grootteTekst(x.grootte)}</span>
                  <Icoon naam="download" grootte={15} className="ml-icoon ml-bijlage-dl" />
                </a>
              </li>
            ))}
          </ul>
        )}

        {b.ingekort && (
          <p className="ml-balk">Dit bericht is erg groot; mogelijk wordt niet alles getoond. Bijlagen kun je wel downloaden.</p>
        )}

        {b.html !== null && b.externeBeelden > 0 && !beelden && (
          <div className="ml-balk ml-balk-beelden">
            <span>
              <Icoon naam="beeld" grootte={15} /> Externe afbeeldingen zijn geblokkeerd voor je privacy.
            </span>
            <button type="button" className="ml-balk-knop" onClick={() => setBeelden(true)}>
              Tonen
            </button>
          </div>
        )}

        {b.html !== null ? (
          <div className="ml-papier">
            <VeiligeMailFrame html={b.html} beeldenTonen={beelden} titel={`Inhoud van ${b.onderwerp || 'de mail'}`} />
          </div>
        ) : b.tekst ? (
          <TekstMail tekst={b.tekst} />
        ) : (
          <p className="ml-leeg-tekst ml-tekst">(Dit bericht heeft geen tekst.)</p>
        )}
      </div>
    </section>
  );
}
