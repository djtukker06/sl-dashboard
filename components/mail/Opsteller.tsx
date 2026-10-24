'use client';

import { useEffect, useRef, useState } from 'react';
import { adresNaam, adresVol, bewaarLaatsteVan, grootteTekst, mailApi, MailApiFout, volleDatum } from '@/lib/mail/client';
import type { Adres, Bericht, InboxDto } from '@/lib/mail/types';
import { useToast } from '@/components/agenda/Toast';
import { AdresVeld } from './AdresVeld';
import { Icoon } from './Iconen';

export type OpstelModus = 'nieuw' | 'antwoord' | 'allen' | 'doorsturen';

const MAX_UPLOAD = 4 * 1024 * 1024;

function metVoorvoegsel(onderwerp: string, voor: 'Re' | 'Fwd') {
  const s = onderwerp.trim();
  const re = voor === 'Re' ? /^(re|antw|aw|sv)\s*:/i : /^(fwd?|doorst|wg)\s*:/i;
  return re.test(s) ? s : `${voor}: ${s}`;
}

function citeer(tekst: string) {
  return tekst
    .slice(0, 20_000)
    .split('\n')
    .map((r) => (r.startsWith('>') ? `>${r}` : `> ${r}`))
    .join('\n');
}

function uniek(lijst: Adres[], zonder: string[]): Adres[] {
  const gezien = new Set(zonder.map((s) => s.toLowerCase()));
  return lijst.filter((a) => {
    const k = a.adres.toLowerCase();
    if (!k || gezien.has(k)) return false;
    gezien.add(k);
    return true;
  });
}

function beginWaarden(modus: OpstelModus, basis: Bericht | null, eigenAdressen: string[], handtekening: string, startAan: string) {
  const hand = handtekening ? `\n\n${handtekening}` : '';
  if (!basis || modus === 'nieuw') {
    return { aan: startAan ? `${startAan}, ` : '', cc: '', onderwerp: '', tekst: hand ? `\n${hand}` : '' };
  }
  if (modus === 'doorsturen') {
    const kop = [
      '---------- Doorgestuurd bericht ----------',
      `Van: ${basis.van ? adresVol(basis.van) : '(onbekend)'}`,
      `Datum: ${volleDatum(basis.datum)}`,
      `Onderwerp: ${basis.onderwerp}`,
      `Aan: ${basis.aan.map(adresVol).join(', ')}`,
      ...(basis.cc.length ? [`Cc: ${basis.cc.map(adresVol).join(', ')}`] : [])
    ].join('\n');
    return {
      aan: '',
      cc: '',
      onderwerp: metVoorvoegsel(basis.onderwerp, 'Fwd'),
      tekst: `\n${hand}\n\n${kop}\n\n${basis.tekst}`
    };
  }
  const ontvanger = basis.antwoordAan.length ? basis.antwoordAan : basis.van ? [basis.van] : [];
  const aan = uniek(ontvanger, eigenAdressen);
  const cc = modus === 'allen' ? uniek([...basis.aan, ...basis.cc], [...eigenAdressen, ...aan.map((a) => a.adres)]) : [];
  return {
    aan: aan.map(adresVol).join(', ') + (aan.length ? ', ' : ''),
    cc: cc.map(adresVol).join(', '),
    onderwerp: metVoorvoegsel(basis.onderwerp, 'Re'),
    tekst: `\n${hand}\n\nOp ${volleDatum(basis.datum)} schreef ${adresNaam(basis.van)}:\n${citeer(basis.tekst)}`
  };
}

const TITELS: Record<OpstelModus, string> = {
  nieuw: 'Nieuwe mail',
  antwoord: 'Beantwoorden',
  allen: 'Allen beantwoorden',
  doorsturen: 'Doorsturen'
};

// "Van": je kiest vanaf welke inbox je verstuurt (ook een met het team gedeelde). Bij
// beantwoorden/doorsturen staat de inbox van het bericht vooraf ingesteld; bij een nieuwe mail
// de inbox die je bekijkt, anders de laatst gebruikte. Handtekening en afzendernaam wisselen mee.
export function Opsteller({
  modus,
  basis,
  basisMb,
  inboxen,
  startVan,
  startAan = '',
  adressenPer,
  laadAdressen,
  onSluit,
  onVerzonden
}: {
  modus: OpstelModus;
  basis: Bericht | null;
  /** De inbox waar het origineel in staat (bij beantwoorden/doorsturen). */
  basisMb: string | null;
  inboxen: InboxDto[];
  startVan: string;
  startAan?: string;
  adressenPer: Record<string, Adres[]>;
  laadAdressen: (mb: string) => void;
  onSluit: () => void;
  onVerzonden: (antwoordOp: { mb: string; map: string; uid: number } | null, van: string) => void;
}) {
  const toast = useToast();
  const kiesbaar = inboxen.filter((i) => i.leesbaar);
  const [van, setVan] = useState(startVan);
  const vanInbox = inboxen.find((i) => i.id === van) ?? kiesbaar[0] ?? inboxen[0];
  const eigenAdressen = inboxen.map((i) => i.email);
  const [begin] = useState(() => beginWaarden(modus, basis, eigenAdressen, vanInbox?.handtekening ?? '', startAan));
  const adressen = adressenPer[van] ?? [];
  const [aan, setAan] = useState(begin.aan);
  const [cc, setCc] = useState(begin.cc);
  const [bcc, setBcc] = useState('');
  const [ccOpen, setCcOpen] = useState(Boolean(begin.cc));
  const [onderwerp, setOnderwerp] = useState(begin.onderwerp);
  const [tekst, setTekst] = useState(begin.tekst);
  const [bestanden, setBestanden] = useState<File[]>([]);
  const origineel = modus === 'doorsturen' && basis ? basis.bijlagen : [];
  const [meeDelen, setMeeDelen] = useState<string[]>(() => origineel.map((b) => b.deel));
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const tekstRef = useRef<HTMLTextAreaElement>(null);
  const bestandRef = useRef<HTMLInputElement>(null);

  // Antwoord: cursor bovenaan het tekstvak (boven de handtekening en het citaat).
  useEffect(() => {
    if (modus === 'antwoord' || modus === 'allen') {
      const t = tekstRef.current;
      if (t) {
        t.focus();
        t.setSelectionRange(0, 0);
        t.scrollTop = 0;
      }
    }
  }, [modus]);

  // Adressuggesties uit de gekozen inbox (pas opgehaald als je opstelt).
  useEffect(() => {
    laadAdressen(van);
  }, [van, laadAdressen]);

  /** Andere afzender: de handtekening in de tekst wisselt mee. */
  const wisselVan = (nieuw: string) => {
    const oud = inboxen.find((i) => i.id === van)?.handtekening ?? '';
    const nieuwe = inboxen.find((i) => i.id === nieuw)?.handtekening ?? '';
    setVan(nieuw);
    if (oud === nieuwe) return;
    setTekst((t) => {
      if (oud && t.includes(oud)) return t.replace(oud, nieuwe);
      if (!oud && nieuwe && !t.trim()) return `\n\n\n${nieuwe}`;
      return t;
    });
  };

  const gewijzigd =
    aan !== begin.aan || cc !== begin.cc || bcc !== '' || onderwerp !== begin.onderwerp || tekst !== begin.tekst || bestanden.length > 0;

  const sluit = () => {
    if (bezig) return;
    if (gewijzigd && !window.confirm('Dit concept weggooien?')) return;
    onSluit();
  };

  const uploadTotaal = bestanden.reduce((s, f) => s + f.size, 0);

  const voegToe = (lijst: FileList | null) => {
    if (!lijst?.length) return;
    const nieuw = [...bestanden, ...Array.from(lijst)];
    const totaal = nieuw.reduce((s, f) => s + f.size, 0);
    if (totaal > MAX_UPLOAD) {
      toast(`Bijlagen mogen samen max. 4 MB zijn (nu ${grootteTekst(totaal)}).`, { fout: true });
      return;
    }
    setBestanden(nieuw);
  };

  const verzend = async () => {
    if (bezig) return;
    setFout(null);
    if (!aan.trim() && !cc.trim() && !bcc.trim()) {
      setFout('Vul minstens één ontvanger in.');
      return;
    }
    if (!onderwerp.trim() && !window.confirm('Verzenden zonder onderwerp?')) return;
    const gegevens = {
      aan,
      cc: ccOpen ? cc : '',
      bcc: ccOpen ? bcc : '',
      onderwerp,
      tekst,
      origineel:
        basis && modus !== 'nieuw'
          ? { mb: basisMb ?? van, map: basis.map, uid: basis.uid, modus: modus === 'doorsturen' ? 'doorsturen' : 'antwoord' }
          : null,
      origineleBijlagen: modus === 'doorsturen' ? meeDelen : []
    };
    let body: FormData | string;
    if (bestanden.length) {
      body = new FormData();
      body.append('gegevens', JSON.stringify(gegevens));
      bestanden.forEach((f) => (body as FormData).append('bijlagen', f, f.name));
    } else {
      body = JSON.stringify(gegevens);
    }
    setBezig(true);
    try {
      const res = await mailApi.verzend(van, body);
      bewaarLaatsteVan(van);
      toast(res.waarschuwing ?? 'Verzonden', res.waarschuwing ? { fout: true } : undefined);
      onVerzonden(
        basis && (modus === 'antwoord' || modus === 'allen') ? { mb: basisMb ?? van, map: basis.map, uid: basis.uid } : null,
        van
      );
    } catch (e) {
      setFout(e instanceof MailApiFout ? e.message : 'Verzenden is niet gelukt.');
      setBezig(false);
    }
  };

  return (
    <section
      className="ml-opsteller"
      aria-label={TITELS[modus]}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          verzend();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          sluit();
        }
      }}
    >
      <header className="ml-opsteller-kop">
        <h2 className="db-label">{TITELS[modus]}</h2>
        <button type="button" className="ml-actie" onClick={sluit} aria-label="Sluiten" title="Sluiten (Esc)">
          <Icoon naam="kruis" grootte={17} />
        </button>
      </header>

      <form
        className="ml-opsteller-form"
        onSubmit={(e) => {
          e.preventDefault();
          verzend();
        }}
      >
        <div className="ml-velden">
          <div className="ml-veld-rij ml-veld-rij-van">
            <label className="ml-veld-label" htmlFor="ml-van">
              Van
            </label>
            {kiesbaar.length > 1 ? (
              <span className="ml-van" style={{ '--ml-inbox-kleur': vanInbox?.kleur } as React.CSSProperties}>
                <span className="ml-inbox-stip" aria-hidden="true" />
                <select id="ml-van" className="ml-van-keuze" value={van} onChange={(e) => wisselVan(e.target.value)} disabled={bezig}>
                  {kiesbaar.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label} — {i.fromName ? `${i.fromName} <${i.email}>` : i.email}
                      {!i.vanMij ? ' (gedeeld)' : ''}
                    </option>
                  ))}
                </select>
              </span>
            ) : (
              <span className="ml-veld-statisch" id="ml-van">
                {vanInbox?.email}
              </span>
            )}
            {!ccOpen && (
              <button type="button" className="ml-link" onClick={() => setCcOpen(true)}>
                Cc/Bcc
              </button>
            )}
          </div>
          <AdresVeld label="Aan" waarde={aan} onChange={setAan} suggesties={adressen} autoFocus={modus === 'nieuw' || modus === 'doorsturen'} />
          {ccOpen && (
            <>
              <AdresVeld label="Cc" waarde={cc} onChange={setCc} suggesties={adressen} />
              <AdresVeld label="Bcc" waarde={bcc} onChange={setBcc} suggesties={adressen} />
            </>
          )}
          <div className="ml-veld-rij">
            <label className="ml-veld-label" htmlFor="ml-onderwerp">
              Onderwerp
            </label>
            <input
              id="ml-onderwerp"
              className="ml-veld"
              value={onderwerp}
              maxLength={500}
              onChange={(e) => setOnderwerp(e.target.value)}
            />
          </div>
        </div>

        <textarea
          ref={tekstRef}
          className="ml-tekstvak"
          aria-label="Bericht"
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          spellCheck
          lang="nl"
        />

        {(bestanden.length > 0 || origineel.length > 0) && (
          <ul className="ml-bijlagen ml-bijlagen-opstel" aria-label="Bijlagen">
            {origineel.map((b) => (
              <li key={`o-${b.deel}`}>
                <label className={`ml-bijlage ml-bijlage-keuze${meeDelen.includes(b.deel) ? '' : ' ml-uit'}`}>
                  <input
                    type="checkbox"
                    checked={meeDelen.includes(b.deel)}
                    onChange={(e) =>
                      setMeeDelen((l) => (e.target.checked ? [...l, b.deel] : l.filter((d) => d !== b.deel)))
                    }
                  />
                  <span className="ml-bijlage-naam">{b.naam}</span>
                  <span className="ml-bijlage-grootte">{grootteTekst(b.grootte)}</span>
                </label>
              </li>
            ))}
            {bestanden.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="ml-bijlage">
                  <Icoon naam="bestand" grootte={16} />
                  <span className="ml-bijlage-naam">{f.name}</span>
                  <span className="ml-bijlage-grootte">{grootteTekst(f.size)}</span>
                  <button
                    type="button"
                    className="ml-bijlage-weg"
                    aria-label={`${f.name} weghalen`}
                    onClick={() => setBestanden((l) => l.filter((_, j) => j !== i))}
                  >
                    <Icoon naam="kruis" grootte={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {fout && (
          <p className="ml-opsteller-fout" role="alert">
            {fout}
          </p>
        )}

        <footer className="ml-opsteller-voet">
          <button type="submit" className="db-knop db-knop-primair" disabled={bezig}>
            <Icoon naam="verzonden" grootte={15} />
            {bezig ? 'Verzenden…' : 'Verzenden'}
          </button>
          <button type="button" className="db-knop" onClick={() => bestandRef.current?.click()} disabled={bezig}>
            <Icoon naam="clip" grootte={15} />
            Bijlage
          </button>
          <input
            ref={bestandRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              voegToe(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="ml-opsteller-hint">
            {uploadTotaal > 0 && <>{grootteTekst(uploadTotaal)} van 4 MB · </>}
            <kbd>⌘</kbd>
            <kbd>Enter</kbd> verzenden
          </span>
          <button type="button" className="ml-link ml-opsteller-weg" onClick={sluit} disabled={bezig}>
            Weggooien
          </button>
        </footer>
      </form>
    </section>
  );
}
