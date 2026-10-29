'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Persoon } from '@/components/team/Persoon';
import { useToast } from '@/components/agenda/Toast';
import { korteDatum, relatief } from '@/lib/dashboard/tijd';
import { jsonBytes, maakFragment, platteTekst, schoonTitel, TITEL_MAX, zelfdeInhoud, type Notitie, type NotitieSamenvatting, type TiptapKnoop } from '@/lib/notities/kern';
import { bewaarConcept, leesConcept, notitieApi, NotitieApiFout, wisConcept, type Concept, type NotitieWijziging } from '@/lib/notities/client';
import { NotitieEditor } from './Editor';
import { EmojiKiezer } from './EmojiKiezer';
import { Koppelen, type Koppeling } from './Koppelen';

// Eén notitie bewerken: icoon, grote titel, koppeling, privé/vastpinnen en de tekst. Alles slaat
// vanzelf op (800 ms na de laatste toets), één verzoek tegelijk, met de versie die je kent
// ("sinds"): heeft een ander de notitie intussen gewijzigd, dan kies je zelf welke versie blijft.
// Nooit werk kwijt: tot het is opgeslagen staat het ook in de browser (concept), en bij
// wegnavigeren of het tabblad sluiten gaat het laatste stuk nog mee (keepalive).

/** Opslaanverzoeken die nog onderweg zijn (per notitie), ook na het sluiten van de editor. */
const onderweg = new Map<string, Promise<void>>();

/** Wacht tot een lopend opslaanverzoek van deze notitie klaar is (vóór opnieuw ophalen). */
export function wachtOpOpslaan(id: string): Promise<void> {
  return onderweg.get(id) ?? Promise.resolve();
}

type Status = 'opgeslagen' | 'wijzigingen' | 'opslaan' | 'fout' | 'conflict';

const VERTRAGING = 800;
/** Grens voor een keepalive-verzoek (browsers staan max. 64 kB toe). */
const KEEPALIVE_MAX = 60_000;

export function NotitieScherm({
  notitie,
  mijnId,
  nieuw = false,
  onBijgewerkt,
  onVerwijder,
  onTerug
}: {
  notitie: Notitie;
  mijnId: string;
  /** Net aangemaakt: de cursor staat in de titel. */
  nieuw?: boolean;
  onBijgewerkt: (n: Partial<NotitieSamenvatting> & { id: string }) => void;
  onVerwijder: (n: NotitieSamenvatting) => void;
  /** Mobiel: terug naar de lijst. */
  onTerug?: () => void;
}) {
  const toast = useToast();
  const id = notitie.id;
  const [titel, setTitel] = useState(notitie.titel);
  const [emoji, setEmoji] = useState(notitie.emoji);
  const [koppeling, setKoppeling] = useState<Koppeling>({ klant: notitie.klant, project: notitie.project });
  const [prive, setPrive] = useState(notitie.prive);
  const [vastgepind, setVastgepind] = useState(notitie.vastgepind);
  const [bewerkt, setBewerkt] = useState({ op: notitie.bewerktOp, door: notitie.bewerktDoor });
  const [status, setStatus] = useState<Status>('opgeslagen');
  const [foutTekst, setFoutTekst] = useState('');
  const [opnieuw, setOpnieuw] = useState(false);
  const [conflict, setConflict] = useState<Notitie | null>(null);
  const [concept, setConcept] = useState<Concept | null>(null);
  const [menu, setMenu] = useState(false);
  const [zeker, setZeker] = useState(false);
  const [editorVersie, setEditorVersie] = useState(0);
  const [startInhoud, setStartInhoud] = useState<TiptapKnoop>(notitie.inhoud);
  const isMaker = notitie.gemaaktDoor === mijnId;

  const editor = useRef<Editor | null>(null);
  const titelRef = useRef<HTMLTextAreaElement>(null);
  const basis = useRef(notitie.bewerktOp);
  const titelNu = useRef(notitie.titel);
  /** Inhoud die net in de editor is gezet (concept terug) zolang de nieuwe editor er nog niet is. */
  const geladen = useRef<TiptapKnoop | null>(null);
  /** Velden die nog naar de server moeten (inhoud en titel worden bij verzenden gelezen). */
  const wachtend = useRef<Omit<NotitieWijziging, 'inhoud' | 'titel' | 'sinds'>>({});
  const vuil = useRef({ inhoud: false, titel: false });
  const bezig = useRef(false);
  const geblokkeerd = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const herhaal = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pogingen = useRef(0);
  // Timers roepen altijd de nieuwste spoel aan.
  const spoelRef = useRef<(opties?: { keepalive?: boolean }) => Promise<void>>(async () => {});

  const heeftWachtend = () => vuil.current.inhoud || vuil.current.titel || Object.keys(wachtend.current).length > 0;

  /** Inhoud nu (of null als de editor al weg is). */
  const huidigeInhoud = useCallback((): TiptapKnoop | null => {
    const e = editor.current;
    if (!e || e.isDestroyed) return null;
    try {
      return e.getJSON() as TiptapKnoop;
    } catch {
      return null;
    }
  }, []);

  const spoel = useCallback(
    async (opties: { keepalive?: boolean } = {}) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (bezig.current || geblokkeerd.current || !heeftWachtend()) return;

      const patch: NotitieWijziging = { ...wachtend.current, sinds: basis.current };
      let inhoud: TiptapKnoop | null = null;
      if (vuil.current.inhoud) {
        // Na "Terugzetten" is de nieuwe editor er soms nog niet: dan de geladen inhoud.
        inhoud = huidigeInhoud() ?? geladen.current;
        if (inhoud) patch.inhoud = inhoud;
      }
      const metInhoud = inhoud !== null;
      const metTitel = vuil.current.titel;
      if (metTitel) patch.titel = titelNu.current;
      // Alleen "sinds" (inhoud gewijzigd maar geen editor): niets te versturen, vuil laten staan.
      if (Object.keys(patch).length === 1) return;
      // Vangnet in de browser, vóór het verzoek (lukt dat niet, dan is het concept er nog).
      if (metInhoud || metTitel) {
        bewaarConcept(mijnId, id, { titel: titelNu.current, inhoud: inhoud ?? huidigeInhoud() ?? startInhoud, basis: basis.current, tijd: Date.now() });
      }
      const verzonden = wachtend.current;
      wachtend.current = {};
      vuil.current = { inhoud: vuil.current.inhoud && !metInhoud, titel: false };
      bezig.current = true;
      setStatus('opslaan');
      // In bytes (UTF-8): emoji en accenten tellen dubbel, anders weigert de browser het verzoek.
      const keepalive = Boolean(opties.keepalive) && jsonBytes(patch) < KEEPALIVE_MAX;
      let klaar: () => void = () => {};
      onderweg.set(id, new Promise<void>((r) => (klaar = r)));
      try {
        const { notitie: n } = await notitieApi.wijzig(id, patch, { keepalive });
        basis.current = n.bewerktOp;
        pogingen.current = 0;
        setBewerkt({ op: n.bewerktOp, door: n.bewerktDoor });
        // Wat intussen opnieuw is gewijzigd (nog onderweg) niet terugzetten naar deze versie.
        const lokaal: Partial<NotitieSamenvatting> & { id: string } = { ...n };
        const nog = wachtend.current;
        if ('emoji' in nog) delete lokaal.emoji;
        if ('prive' in nog) delete lokaal.prive;
        if ('vastgepind' in nog) delete lokaal.vastgepind;
        if ('klantId' in nog || 'projectId' in nog) {
          delete lokaal.klant;
          delete lokaal.project;
        } else {
          // De server weet of de klant een lead is (en vult de klant bij een project aan).
          setKoppeling({ klant: n.klant, project: n.project });
        }
        lokaal.titel = vuil.current.titel ? titelNu.current : (patch.titel ?? n.titel);
        if (inhoud) lokaal.fragment = maakFragment(platteTekst(inhoud), 240);
        onBijgewerkt(lokaal);
        setFoutTekst('');
        if (!heeftWachtend()) {
          wisConcept(mijnId, id);
          setStatus('opgeslagen');
        }
      } catch (e) {
        // Terugzetten wat niet is aangekomen (nieuwere wijzigingen gaan voor).
        wachtend.current = { ...verzonden, ...wachtend.current };
        vuil.current = { inhoud: vuil.current.inhoud || metInhoud, titel: vuil.current.titel || metTitel };
        const f = e instanceof NotitieApiFout ? e : null;
        if (f?.conflict && f.huidig) {
          geblokkeerd.current = true;
          setConflict(f.huidig);
          setStatus('conflict');
        } else if (f && [400, 403, 404, 413].includes(f.status)) {
          // Opnieuw proberen helpt niet; het concept blijft in de browser staan.
          geblokkeerd.current = true;
          setFoutTekst(f.message);
          setOpnieuw(false);
          setStatus('fout');
        } else {
          setFoutTekst(f?.message || 'Opslaan mislukt.');
          setOpnieuw(true);
          setStatus('fout');
          // Geen verbinding of een storing: rustig opnieuw proberen (2, 4, 8 … max. 30 s).
          pogingen.current += 1;
          if (herhaal.current) clearTimeout(herhaal.current);
          herhaal.current = setTimeout(() => void spoelRef.current(), Math.min(30_000, 1000 * 2 ** pogingen.current));
        }
      } finally {
        bezig.current = false;
        onderweg.delete(id);
        klaar();
      }
      // Tijdens het opslaan getypt: meteen de volgende ronde inplannen.
      if (heeftWachtend() && !geblokkeerd.current && pogingen.current === 0) {
        timer.current = setTimeout(() => void spoelRef.current(), VERTRAGING);
      }
    },
    [id, mijnId, onBijgewerkt, huidigeInhoud, startInhoud]
  );
  useEffect(() => {
    spoelRef.current = spoel;
  }, [spoel]);

  /** Opslaan inplannen (direct = zonder de vertraging, bv. voor een klik op een knop). */
  const plan = useCallback((direct = false) => {
    setStatus((s) => (s === 'conflict' || s === 'opslaan' ? s : 'wijzigingen'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void spoelRef.current(), direct ? 0 : VERTRAGING);
  }, []);

  // Inhoud gewijzigd (vanuit de editor).
  const opInhoud = useCallback(() => {
    vuil.current.inhoud = true;
    plan();
  }, [plan]);

  const opEditor = useCallback((e: Editor | null) => {
    editor.current = e;
    // De nieuwe editor heeft de geladen inhoud nu zelf.
    if (e) geladen.current = null;
  }, []);

  // Concept uit de browser van een eerdere sessie die niet is aangekomen?
  useEffect(() => {
    const c = leesConcept(mijnId, id);
    if (!c) return;
    // Al aangekomen (bv. het laatste stuk bij het sluiten van het tabblad)? Dan weg met het concept.
    const zelfde = schoonTitel(c.titel) === notitie.titel && zelfdeInhoud(c.inhoud, notitie.inhoud);
    if (zelfde) wisConcept(mijnId, id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- eenmalig bij openen, uit localStorage
    else setConcept(c);
    // Alleen bij het openen van deze notitie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Wegnavigeren, tabblad wisselen of sluiten: het laatste stuk direct versturen.
  useEffect(() => {
    const verberg = () => {
      if (document.visibilityState === 'hidden') void spoel({ keepalive: true });
    };
    const weg = () => void spoel({ keepalive: true });
    const waarschuw = (e: BeforeUnloadEvent) => {
      if (heeftWachtend() || bezig.current) {
        void spoel({ keepalive: true });
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', verberg);
    window.addEventListener('pagehide', weg);
    window.addEventListener('beforeunload', waarschuw);
    return () => {
      document.removeEventListener('visibilitychange', verberg);
      window.removeEventListener('pagehide', weg);
      window.removeEventListener('beforeunload', waarschuw);
    };
  }, [spoel]);

  // Bij verlaten van deze notitie (andere notitie, andere pagina): versturen wat er nog ligt.
  useEffect(
    () => () => {
      if (herhaal.current) clearTimeout(herhaal.current);
      void spoel({ keepalive: true });
    },
    [spoel]
  );

  // Titel: hoogte volgt de tekst.
  useEffect(() => {
    const t = titelRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }, [titel]);

  useEffect(() => {
    if (nieuw) titelRef.current?.focus();
  }, [nieuw]);

  function wijzigTitel(waarde: string) {
    const t = waarde.replace(/[\r\n]+/g, ' ').slice(0, TITEL_MAX);
    setTitel(t);
    titelNu.current = schoonTitel(t);
    vuil.current.titel = true;
    onBijgewerkt({ id, titel: titelNu.current });
    plan();
  }

  function zet(patch: Omit<NotitieWijziging, 'inhoud' | 'titel' | 'sinds'>) {
    Object.assign(wachtend.current, patch);
    plan(true);
  }

  function kiesEmoji(e: string | null) {
    setEmoji(e);
    onBijgewerkt({ id, emoji: e });
    zet({ emoji: e });
  }

  function wijzigKoppeling(k: Koppeling) {
    setKoppeling(k);
    onBijgewerkt({ id, klant: k.klant, project: k.project });
    zet({ klantId: k.klant?.id ?? null, projectId: k.project?.id ?? null });
  }

  function wisselPrive() {
    const p = !prive;
    setPrive(p);
    onBijgewerkt({ id, prive: p });
    zet({ prive: p });
    toast(p ? 'Privé: alleen jij ziet deze notitie.' : 'Gedeeld met het team.');
  }

  function wisselPin() {
    const v = !vastgepind;
    setVastgepind(v);
    onBijgewerkt({ id, vastgepind: v });
    zet({ vastgepind: v });
  }

  /** Andere inhoud in de editor zetten (concept terug, hun versie) zonder autosave-lus. */
  function laadInhoud(inhoud: TiptapKnoop, t: string) {
    geladen.current = inhoud;
    setStartInhoud(inhoud);
    setEditorVersie((v) => v + 1);
    setTitel(t);
    titelNu.current = schoonTitel(t);
  }

  function conceptTerug() {
    if (!concept) return;
    laadInhoud(concept.inhoud, concept.titel);
    vuil.current = { inhoud: true, titel: true };
    setConcept(null);
    onBijgewerkt({ id, titel: schoonTitel(concept.titel) });
    plan(true);
  }

  function conceptWeg() {
    wisConcept(mijnId, id);
    setConcept(null);
  }

  function houdMijnVersie() {
    if (!conflict) return;
    basis.current = conflict.bewerktOp;
    vuil.current = { inhoud: true, titel: true };
    geblokkeerd.current = false;
    setConflict(null);
    plan(true);
  }

  function laadHunVersie() {
    if (!conflict) return;
    basis.current = conflict.bewerktOp;
    wachtend.current = {};
    vuil.current = { inhoud: false, titel: false };
    geblokkeerd.current = false;
    laadInhoud(conflict.inhoud, conflict.titel);
    setEmoji(conflict.emoji);
    setKoppeling({ klant: conflict.klant, project: conflict.project });
    setPrive(conflict.prive);
    setVastgepind(conflict.vastgepind);
    setBewerkt({ op: conflict.bewerktOp, door: conflict.bewerktDoor });
    onBijgewerkt(conflict);
    wisConcept(mijnId, id);
    setConflict(null);
    setStatus('opgeslagen');
  }

  async function verwijder() {
    setMenu(false);
    setZeker(false);
    await spoel();
    onVerwijder({ ...notitie, titel: titelNu.current, emoji, prive, vastgepind, klant: koppeling.klant, project: koppeling.project, bewerktOp: basis.current });
  }

  const statusTekst =
    status === 'opslaan' ? 'Opslaan…' : status === 'wijzigingen' ? 'Wijzigingen…' : status === 'fout' ? 'Niet opgeslagen' : status === 'conflict' ? 'Conflict' : 'Opgeslagen';

  return (
    <article className="sp-notitie" aria-label={titel || 'Naamloze notitie'}>
      <div className="sp-notitie-balk">
        {onTerug && (
          <button type="button" className="sp-meta-knop sp-terug" onClick={onTerug}>
            ← Notities
          </button>
        )}
        <span className={`sp-status is-${status}`} role="status" aria-live="polite" title={foutTekst || undefined}>
          <span className="sp-status-stip" aria-hidden="true" />
          {statusTekst}
        </span>
        <div className="sp-notitie-acties">
          <button type="button" className={`sp-meta-knop${vastgepind ? ' is-aan' : ''}`} aria-pressed={vastgepind} onClick={wisselPin} title="Vastpinnen: bovenaan in de lijst en op het dashboard">
            <svg viewBox="0 0 24 24" width="14" height="14" fill={vastgepind ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 3.5h6l-1 5 3.5 3.5v1.5h-11V12L10 8.5z" />
              <path d="M12 13.5V20" strokeLinecap="round" />
            </svg>
            {vastgepind ? 'Vastgepind' : 'Vastpinnen'}
          </button>
          <button
            type="button"
            className={`sp-meta-knop${prive ? ' is-aan' : ''}`}
            aria-pressed={prive}
            onClick={wisselPrive}
            disabled={!isMaker}
            title={isMaker ? (prive ? 'Alleen jij ziet deze notitie. Klik om te delen met het team.' : 'Gedeeld met het team. Klik om privé te maken.') : 'Alleen de maker kan dit wijzigen.'}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              {prive ? (
                <>
                  <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
                  <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
                </>
              ) : (
                <>
                  <circle cx="9" cy="9" r="3" />
                  <path d="M3.5 19c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.7.6 2.7 2 3 4.2" />
                </>
              )}
            </svg>
            {prive ? 'Privé' : 'Team'}
          </button>
          <div className="sp-menu">
            <button type="button" className="sp-meta-knop" aria-label="Meer acties" aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu((m) => !m); setZeker(false); }}>
              ···
            </button>
            {menu && (
              <div className="sp-pop sp-menu-pop" role="menu" onMouseLeave={() => setZeker(false)}>
                <button
                  type="button"
                  role="menuitem"
                  className="sp-menu-item"
                  onClick={async () => {
                    const t = huidigeInhoud();
                    try {
                      await navigator.clipboard.writeText([titelNu.current, t ? platteTekst(t) : ''].filter(Boolean).join('\n\n'));
                      toast('Tekst gekopieerd.');
                    } catch {
                      toast('Kopiëren lukte niet.', { fout: true });
                    }
                    setMenu(false);
                  }}
                >
                  Tekst kopiëren
                </button>
                <button type="button" role="menuitem" className={`sp-menu-item is-gevaar${zeker ? ' is-zeker' : ''}`} onClick={() => (zeker ? void verwijder() : setZeker(true))}>
                  {zeker ? 'Zeker weten? Klik nog eens' : 'Verwijderen'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {conflict && (
        <div className="sp-banner is-let-op" role="alert">
          <p>
            {conflict.bewerktDoor === mijnId ? (
              <>Je hebt deze notitie {relatief(conflict.bewerktOp)} ook in een ander venster bewerkt.</>
            ) : (
              <>
                <Persoon id={conflict.bewerktDoor} /> heeft deze notitie {relatief(conflict.bewerktOp)} ook bewerkt.
              </>
            )}{' '}
            Welke versie blijft?
          </p>
          <span className="sp-banner-acties">
            <button type="button" className="db-knop db-knop-klein db-knop-primair" onClick={houdMijnVersie}>
              Mijn versie bewaren
            </button>
            <button type="button" className="db-knop db-knop-klein" onClick={laadHunVersie}>
              Hun versie laden
            </button>
          </span>
        </div>
      )}
      {concept && !conflict && (
        <div className="sp-banner" role="note">
          <p>Er staat een niet-opgeslagen versie van {korteDatum(new Date(concept.tijd).toISOString())} in deze browser.</p>
          <span className="sp-banner-acties">
            <button type="button" className="db-knop db-knop-klein db-knop-primair" onClick={conceptTerug}>
              Terugzetten
            </button>
            <button type="button" className="db-knop db-knop-klein" onClick={conceptWeg}>
              Weggooien
            </button>
          </span>
        </div>
      )}
      {status === 'fout' && foutTekst && (
        <p className="sp-fout" role="alert">
          {foutTekst} Je tekst staat veilig in deze browser{opnieuw ? '; we proberen het zo opnieuw' : ''}.
        </p>
      )}

      <div className="sp-blad">
        <div className="sp-kopregel">
          <EmojiKiezer waarde={emoji} onKies={kiesEmoji} />
          <Koppelen waarde={koppeling} onWijzig={wijzigKoppeling} />
        </div>
        <textarea
          ref={titelRef}
          className="sp-titel"
          rows={1}
          value={titel}
          maxLength={TITEL_MAX}
          placeholder="Naamloos"
          aria-label="Titel"
          onChange={(e) => wijzigTitel(e.target.value)}
          onKeyDown={(e) => {
            // Enter of ↓ aan het eind: verder in de tekst.
            const t = e.currentTarget;
            if (e.key === 'Enter' || (e.key === 'ArrowDown' && t.selectionStart === t.value.length)) {
              e.preventDefault();
              editor.current?.commands.focus('start');
            }
          }}
        />
        <p className="sp-wie">
          <Persoon id={notitie.gemaaktDoor} voorvoegsel="door" />
          <span className="sp-wie-tekst" suppressHydrationWarning>
            {notitie.gemaaktDoor ? ' · ' : ''}
            {korteDatum(notitie.gemaaktOp)}
            {bewerkt.op !== notitie.gemaaktOp && <> · bewerkt {relatief(bewerkt.op)}</>}
          </span>
          {bewerkt.door && bewerkt.door !== notitie.gemaaktDoor && (
            <>
              <span className="sp-wie-tekst"> door </span>
              <Persoon id={bewerkt.door} />
            </>
          )}
        </p>
        <NotitieEditor key={editorVersie} inhoud={startInhoud} onWijziging={opInhoud} onKlaar={opEditor} />
      </div>
    </article>
  );
}
