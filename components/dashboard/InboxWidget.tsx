'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adresNaam, leesCache, lijstDatum, mailApi, MailApiFout, meldOngelezen, schrijfCache } from '@/lib/mail/client';
import type { MailOverzicht } from '@/lib/mail/types';
import { Kaart, KaartMelding } from './Kaart';

const CACHE = 'sl-mail-overzicht';

// Inbox op het dashboard: de laatste berichten over ALLE inboxen die je mag zien (eigen en
// met het team gedeeld), met bij meerdere inboxen een kleurchip per inbox; het aantal
// ongelezen is de som. Een client-component, zodat de IMAP-verbinding de eerste
// weergave van het dashboard niet vertraagt. 60 s cache in sessionStorage: terug naar het
// dashboard is meteen gevuld. Daarna ververst de widget net als de rail-badge: bij terugkeren
// naar het tabblad en elke 2 minuten (alleen als het tabblad zichtbaar is), en zodra iets
// anders op de pagina een ander aantal ongelezen meldt.
const VERS_MS = 60_000;
const INTERVAL_MS = 120_000;

export function InboxWidget() {
  const [data, setData] = useState<MailOverzicht | null>(null);
  const [fout, setFout] = useState<MailApiFout | null>(null);
  const [bezig, setBezig] = useState(false);
  const geladenOp = useRef(0);
  const bezigRef = useRef(false);
  const ongelezenRef = useRef<number | null>(null);

  const laad = useCallback(async () => {
    if (bezigRef.current) return;
    bezigRef.current = true;
    setBezig(true);
    try {
      const res = await mailApi.overzicht();
      geladenOp.current = Date.now();
      ongelezenRef.current = res.geconfigureerd ? res.ongelezen : null;
      setData(res);
      setFout(null);
      schrijfCache(CACHE, res);
      if (res.geconfigureerd) meldOngelezen(res.ongelezen);
    } catch (e) {
      setFout(e instanceof MailApiFout ? e : new MailApiFout(0, 'Inbox laden mislukt.'));
    } finally {
      bezigRef.current = false;
      setBezig(false);
    }
  }, []);

  useEffect(() => {
    const cache = leesCache<MailOverzicht>(CACHE);
    // Uit de cache tonen gebeurt na het mounten (sessionStorage bestaat niet op de server).
    if (cache) {
      // De cache is hooguit 60 s oud; als "net geladen" rekenen voorkomt een dubbele fetch.
      geladenOp.current = Date.now();
      ongelezenRef.current = cache.geconfigureerd ? cache.ongelezen : null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(cache);
    } else laad();
  }, [laad]);

  // Verversen: bij terugkeren naar het tabblad, elke 2 min als het zichtbaar is, en bij
  // een afwijkend aantal ongelezen dat een ander deel van deze pagina meldt.
  useEffect(() => {
    const alsVerouderd = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - geladenOp.current >= VERS_MS) void laad();
    };
    const opMelding = (e: Event) => {
      const aantal = Number((e as CustomEvent).detail) || 0;
      if (ongelezenRef.current !== null && aantal !== ongelezenRef.current) void laad();
    };
    document.addEventListener('visibilitychange', alsVerouderd);
    window.addEventListener('sl-mail-ongelezen', opMelding);
    const timer = window.setInterval(alsVerouderd, INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', alsVerouderd);
      window.removeEventListener('sl-mail-ongelezen', opMelding);
      window.clearInterval(timer);
    };
  }, [laad]);

  const ongelezen = data?.ongelezen ?? 0;
  const inboxen = new Map((data?.inboxen ?? []).map((i) => [i.id, i]));
  const meerdere = inboxen.size > 1;
  const label = data && data.geconfigureerd && ongelezen > 0 ? `Inbox · ${ongelezen} ongelezen` : 'Inbox';

  return (
    <Kaart label={label} href="/mail" linkTekst="Mail" className="db-smal db-inbox">
      {fout && !data ? (
        fout.nietGekoppeld ? (
          <KaartMelding titel="Mail is nog niet gekoppeld" toon="setup" actie={<Link className="db-knop" href="/account#mailbox">Koppelen</Link>}>
            Koppel je inbox via Account &amp; mail.
          </KaartMelding>
        ) : (
          <KaartMelding
            titel="Inbox nu niet bereikbaar"
            toon="fout"
            actie={
              <button type="button" className="db-knop" onClick={laad} disabled={bezig}>
                {bezig ? 'Bezig…' : 'Opnieuw'}
              </button>
            }
          >
            {fout.message}
          </KaartMelding>
        )
      ) : !data ? (
        <div aria-busy="true" aria-label="Inbox laden" className="db-inbox-skelet">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="db-inbox-skelet-rij">
              <div className="db-skelet" style={{ width: `${45 - i * 5}%` }} />
              <div className="db-skelet" style={{ width: `${88 - i * 9}%` }} />
            </div>
          ))}
        </div>
      ) : !data.geconfigureerd ? (
        <KaartMelding titel="Mail is nog niet gekoppeld" toon="setup" actie={<Link className="db-knop" href="/account#mailbox">Koppelen</Link>}>
          Koppel je inbox via Account &amp; mail; daarna zie je hier je nieuwste mail.
        </KaartMelding>
      ) : data.berichten.length === 0 ? (
        <KaartMelding titel="Inbox is leeg">Alles bijgewerkt.</KaartMelding>
      ) : (
        <ul className="db-lijst db-mails">
          {(data.fouten?.length ?? 0) > 0 && (
            <li className="db-mail-fout" role="status">
              Nu niet bereikbaar: {data.fouten!.map((f) => f.label).join(', ')}
            </li>
          )}
          {data.berichten.map((b) => {
            const inbox = b.mb ? inboxen.get(b.mb) : undefined;
            const href = b.mb ? `/mail?${new URLSearchParams({ mb: b.mb, uid: String(b.uid) })}` : `/mail?uid=${b.uid}`;
            return (
            <li key={`${b.mb ?? ''}:${b.uid}`}>
              <Link className={`db-rij db-mail${b.gelezen ? '' : ' db-mail-nieuw'}`} href={href}>
                <span className="db-mail-stip" aria-hidden="true" />
                <span className="db-rij-hoofd">
                  <span className="db-mail-van">
                    {adresNaam(b.van)}
                    {meerdere && inbox && (
                      <span className="db-mail-inbox" style={{ '--ml-inbox-kleur': inbox.kleur } as React.CSSProperties} title={inbox.email}>
                        {inbox.label}
                      </span>
                    )}
                  </span>
                  <span className="db-mail-onderwerp">{b.onderwerp || '(geen onderwerp)'}</span>
                </span>
                <time className="db-mail-tijd" dateTime={b.datum ?? undefined}>
                  {lijstDatum(b.datum)}
                </time>
                {!b.gelezen && <span className="sr-only">ongelezen</span>}
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </Kaart>
  );
}
