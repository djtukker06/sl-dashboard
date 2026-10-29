'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

// Openingsanimatie van /login (GSAP). Of hij speelt, beslist het inline script in
// app/login/page.tsx al tijdens het parsen (klasse "sl-intro" op .login-wrap): één keer per
// browsersessie, niet na een foutmelding of bij reduced motion. Zo staat de begintoestand in
// CSS vóór de hydratie (geen flits van het formulier) en is zonder JavaScript het formulier
// gewoon zichtbaar.
//
// Verloop (~2,5 s): het beeldmerk groeit van onder naar boven op, met een lichtbaan erover;
// schuift naar links terwijl "Studio", "Levant" en de payoff inwipen; daarna landt het hele
// logo precies op de banner in de inlogkaart (FLIP) en komt het formulier gestaffeld binnen.
// Klik, toets of "Overslaan" slaat hem over. Focus gaat pas daarna naar het e-mailveld.

// Delen van banner-licht.png (800×297): beeldmerk x 0–293, tekst vanaf x 325;
// regels "Studio" y 0–111, "Levant" y 124–234, payoff y 259–288. Houd gelijk aan de CSS.
const MERK = 'inset(0% 61.5% 0% 0%)';
const MERK_START = 'inset(100% 61.5% 0% 0%)';
const REGELS = [
  { eind: 'inset(0% 0% 60.6% 38.5%)', start: 'inset(0% 61.5% 60.6% 38.5%)' },
  { eind: 'inset(39.4% 0% 17.2% 38.5%)', start: 'inset(39.4% 61.5% 17.2% 38.5%)' },
  { eind: 'inset(82.8% 0% 0% 38.5%)', start: 'inset(82.8% 61.5% 0% 38.5%)' }
];
// Midden van het beeldmerk ligt op 18,3% van de banner: zoveel naar rechts staat hij in het midden.
const MERK_MIDDEN = 31.7;

export function Openingsanimatie() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const intro = ref.current;
    const wrap = intro?.closest<HTMLElement>('.login-wrap');
    const email = wrap?.querySelector<HTMLInputElement>('input[name="email"]');

    // Alleen focussen als de gebruiker (of een wachtwoordmanager) nog niets anders koos.
    const focusEmail = () => {
      const actief = document.activeElement;
      if (email && (!actief || actief === document.body || intro?.contains(actief))) email.focus({ preventScroll: true });
    };

    if (
      !intro ||
      !wrap ||
      !wrap.classList.contains('sl-intro') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      wrap?.classList.remove('sl-intro');
      focusEmail();
      return;
    }
    const kaart = wrap.querySelector<HTMLElement>('.login-card');
    const banner = wrap.querySelector<HTMLElement>('.login-banner');
    const logo = intro.querySelector<HTMLElement>('.login-intro-logo');
    if (!kaart || !banner || !logo) {
      wrap.classList.remove('sl-intro');
      focusEmail();
      return;
    }

    wrap.setAttribute('data-intro-bezig', '');
    const doos = wrap; // vaste verwijzing voor afronden() (TS vernauwt niet in functiedeclaraties)
    let klaar = false;
    let uitfaden: gsap.core.Tween | null = null;

    const ctx = gsap.context(() => {
      // FLIP: van het logo midden in beeld naar de banner in de (nog onzichtbare) kaart.
      const van = logo.getBoundingClientRect();
      const naar = banner.getBoundingClientRect();
      const flip = {
        x: naar.left - van.left,
        y: naar.top - van.top,
        scale: van.width ? naar.width / van.width : 1
      };

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, onComplete: () => afronden(false) });

      tl.set('.login-intro-laag', { opacity: 1 })
        // 1. beeldmerk groeit van onder naar boven op, scherp uit een zachte waas
        .fromTo(
          '.login-intro-merk',
          { clipPath: MERK_START, xPercent: MERK_MIDDEN, scale: 0.92, filter: 'blur(8px)', transformOrigin: '18.3% 50%' },
          { clipPath: MERK, scale: 1, filter: 'blur(0px)', duration: 1, ease: 'expo.out' },
          0.05
        )
        // 2. lichtbaan schuift diagonaal over het beeldmerk
        .fromTo(
          '.login-intro-glans',
          { backgroundPosition: '93% 0%', opacity: 0 },
          { backgroundPosition: '48% 0%', opacity: 0.75, duration: 0.7, ease: 'power2.inOut' },
          0.5
        )
        .to('.login-intro-glans', { opacity: 0, duration: 0.3, ease: 'power1.out' }, 1.0)
        // 3. beeldmerk schuift naar links, de woorden wipen regel voor regel in
        .to('.login-intro-merk', { xPercent: 0, duration: 0.75, ease: 'power3.inOut' }, 0.9);

      REGELS.forEach((r, i) => {
        tl.fromTo(
          `.login-intro-regel-${i + 1}`,
          { clipPath: r.start, x: -14, opacity: 0, filter: 'blur(4px)' },
          { clipPath: r.eind, x: 0, opacity: 1, filter: 'blur(0px)', duration: i === 2 ? 0.6 : 0.7 },
          1.1 + i * 0.09 + (i === 2 ? 0.12 : 0)
        );
      });

      // 4. logo landt op de banner, achtergrond lost op, kaart en formulier komen binnen
      tl.to(logo, { ...flip, transformOrigin: '0 0', duration: 0.65, ease: 'power3.inOut' }, 1.85)
        .to('.login-intro-bg', { opacity: 0, duration: 0.6, ease: 'power2.inOut' }, 1.9)
        .to('.login-intro-skip', { opacity: 0, duration: 0.25 }, 1.85)
        .fromTo(kaart, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' }, 2.0)
        .fromTo(
          '.login-card > h1, .login-card > .login-melding, .login-card > .foutmelding, .login-card form > label, .login-card form > button, .login-card > .login-link',
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.45, stagger: 0.06 },
          2.1
        );
    }, wrap);

    // Klaar (of overgeslagen): alles terug naar de gewone CSS en de echte banner tonen.
    // Bij overslaan vervaagt het overlay nog kort in plaats van weg te springen.
    function afronden(vervagen: boolean) {
      if (klaar) return;
      klaar = true;
      weg();
      ctx.revert();
      if (vervagen && intro) {
        intro.style.display = 'flex';
        intro.style.pointerEvents = 'none'; // het formulier is meteen klikbaar
        uitfaden = gsap.to(intro, {
          opacity: 0,
          duration: 0.25,
          ease: 'power1.out',
          onComplete: () => gsap.set(intro, { clearProps: 'display,opacity,pointerEvents' })
        });
      }
      doos.classList.remove('sl-intro');
      doos.removeAttribute('data-intro-bezig');
      focusEmail();
    }

    const opToets = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      // Sneltoetsen van de browser (herladen, tabblad sluiten) gewoon laten werken.
      if (!e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();
      afronden(true);
    };
    const opKlik = (e: PointerEvent) => {
      e.preventDefault();
      afronden(true);
    };
    function weg() {
      window.removeEventListener('keydown', opToets, true);
      intro?.removeEventListener('pointerdown', opKlik);
    }
    window.addEventListener('keydown', opToets, true);
    intro.addEventListener('pointerdown', opKlik);

    return () => {
      weg();
      uitfaden?.kill();
      ctx.revert();
      wrap.removeAttribute('data-intro-bezig');
      // Niet afgerond (bv. dubbele effect-run in development): de klasse blijft staan, zodat
      // een nieuwe mount opnieuw begint.
    };
  }, []);

  return (
    <div ref={ref} className="login-intro">
      <div className="login-intro-bg" aria-hidden="true" />
      <div className="login-intro-logo" aria-hidden="true">
        <div className="login-intro-laag login-intro-merk">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/banner-licht.png" alt="" width={800} height={297} />
          <span className="login-intro-glans" />
        </div>
        {[1, 2, 3].map((n) => (
          <div key={n} className={`login-intro-laag login-intro-regel login-intro-regel-${n}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/banner-licht.png" alt="" width={800} height={297} />
          </div>
        ))}
      </div>
      {/* Werkt via de pointerdown/keydown-handlers hierboven (Enter/spatie zijn ook toetsen). */}
      <button type="button" className="login-intro-skip">
        Overslaan
      </button>
    </div>
  );
}
