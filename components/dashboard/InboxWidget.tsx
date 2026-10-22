'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { adresNaam, leesCache, lijstDatum, mailApi, MailApiFout, meldOngelezen, schrijfCache } from '@/lib/mail/client';
import type { MailOverzicht } from '@/lib/mail/types';
import { Kaart, KaartMelding } from './Kaart';

const CACHE = 'sl-mail-overzicht';

// Inbox op het dashboard. Een client-component, zodat de IMAP-verbinding de eerste
// weergave van het dashboard niet vertraagt. 60 s cache in sessionStorage: terug naar het
// dashboard is meteen gevuld.
export function InboxWidget() {
  const [data, setData] = useState<MailOverzicht | null>(null);
  const [fout, setFout] = useState<MailApiFout | null>(null);
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    setBezig(true);
    try {
      const res = await mailApi.overzicht();
      setData(res);
      setFout(null);
      schrijfCache(CACHE, res);
      if (res.geconfigureerd) meldOngelezen(res.ongelezen);
    } catch (e) {
      setFout(e instanceof MailApiFout ? e : new MailApiFout(0, 'Inbox laden mislukt.'));
    } finally {
      setBezig(false);
    }
  }, []);

  useEffect(() => {
    const cache = leesCache<MailOverzicht>(CACHE);
    // Uit de cache tonen gebeurt na het mounten (sessionStorage bestaat niet op de server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cache) setData(cache);
    else laad();
  }, [laad]);

  const ongelezen = data?.ongelezen ?? 0;
  const label = data && data.geconfigureerd && ongelezen > 0 ? `Inbox · ${ongelezen} ongelezen` : 'Inbox';

  return (
    <Kaart label={label} href="/mail" linkTekst="Mail" className="db-smal db-inbox">
      {fout && !data ? (
        fout.nietGekoppeld ? (
          <KaartMelding titel="Mail is nog niet gekoppeld" toon="setup">
            Zet MAIL_USER en MAIL_PASSWORD in de omgevingsvariabelen.
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
        <KaartMelding titel="Mail is nog niet gekoppeld" toon="setup" actie={<Link className="db-knop" href="/mail">Uitleg</Link>}>
          Zet MAIL_USER en MAIL_PASSWORD in de omgevingsvariabelen; de server staat al goed voor Private Email.
        </KaartMelding>
      ) : data.berichten.length === 0 ? (
        <KaartMelding titel="Inbox is leeg">Alles bijgewerkt.</KaartMelding>
      ) : (
        <ul className="db-lijst db-mails">
          {data.berichten.map((b) => (
            <li key={b.uid}>
              <Link className={`db-rij db-mail${b.gelezen ? '' : ' db-mail-nieuw'}`} href={`/mail?uid=${b.uid}`}>
                <span className="db-mail-stip" aria-hidden="true" />
                <span className="db-rij-hoofd">
                  <span className="db-mail-van">{adresNaam(b.van)}</span>
                  <span className="db-mail-onderwerp">{b.onderwerp || '(geen onderwerp)'}</span>
                </span>
                <time className="db-mail-tijd" dateTime={b.datum ?? undefined}>
                  {lijstDatum(b.datum)}
                </time>
                {!b.gelezen && <span className="sr-only">ongelezen</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Kaart>
  );
}
