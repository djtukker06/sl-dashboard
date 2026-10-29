'use client';

import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { WELKOM_GELDIG_MS, WELKOM_SLEUTEL } from '@/lib/shell/welkom';

// Welkomstanimatie direct na het inloggen (na de 2FA-code), GSAP, ~2 s. Alleen het beeldmerk,
// zonder tekst:
//   1. het merk vlecht zich in uit zijn eigen golvende stroken (afwisselend van boven en van
//      onder, scherp uit een waas), terwijl er een dunne ring omheen tekent;
//   2. een lichtbaan glijdt eroverheen;
//   3. het merk zwelt zacht uit en lost op, het donkere vlak opent als een iris vanuit het
//      midden en het dashboard (rail + inhoud) schuift erachter in beeld.
// Of hij speelt: lib/shell/welkom.ts (vers tijdstempel van het inlogformulier of de 2FA-stap).
// Bij een volledige paginalading zet het inline script van de shell de klasse sl-welkom-aan al
// vóór de eerste paint; bij een client-navigatie (inloggen zonder 2FA) doet useLayoutEffect
// dat, ook vóór de paint. Klik of toets slaat hem over; reduced motion: geen animatie.

const STROKEN = 7;

export function Welkomstanimatie() {
  const ref = useRef<HTMLDivElement>(null);
  /** Eén keer beslissen per mount (de dubbele effect-run in development leest de vlag niet opnieuw). */
  const spelen = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    const laag = ref.current;
    const shell = laag?.closest<HTMLElement>('.sl-shell');
    if (!laag || !shell) return;

    if (spelen.current === null) {
      let vers = false;
      try {
        const t = Number(sessionStorage.getItem(WELKOM_SLEUTEL));
        vers = Boolean(t) && Date.now() - t <= WELKOM_GELDIG_MS;
        sessionStorage.removeItem(WELKOM_SLEUTEL);
      } catch {
        /* geen opslag */
      }
      spelen.current = vers && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    if (!spelen.current) {
      shell.classList.remove('sl-welkom-aan');
      return;
    }
    shell.classList.add('sl-welkom-aan');
    laag.setAttribute('data-bezig', '');

    const main = shell.querySelector<HTMLElement>('.sl-main');
    const rail = shell.querySelector<HTMLElement>('.sl-rail');
    let klaar = false;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, onComplete: () => afronden() });
      const stroken = gsap.utils.toArray<HTMLElement>('.sl-welkom-strook');

      tl.set(laag, { autoAlpha: 1 })
        // 1. stroken vlechten in, merk groeit, ring tekent
        .fromTo('.sl-welkom-merk', { scale: 0.84 }, { scale: 1, duration: 1.15, ease: 'expo.out' }, 0)
        .fromTo(
          stroken,
          { yPercent: (i: number) => (i % 2 ? -22 : 22), opacity: 0, filter: 'blur(6px)' },
          { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.85, ease: 'expo.out', stagger: { each: 0.055, from: 'center' } },
          0.05
        )
        .fromTo('.sl-welkom-ring circle', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.05, ease: 'power2.inOut' }, 0.12)
        .fromTo('.sl-welkom-ring', { rotation: -110, opacity: 0 }, { rotation: 0, opacity: 1, duration: 1.1, ease: 'power3.out' }, 0.1)
        .fromTo('.sl-welkom-gloed', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 1, ease: 'power2.out' }, 0.2)
        // 2. lichtbaan
        .fromTo('.sl-welkom-glans', { backgroundPosition: '120% 0%', opacity: 0 }, { backgroundPosition: '-20% 0%', opacity: 0.85, duration: 0.6, ease: 'power2.inOut' }, 0.8)
        .to('.sl-welkom-glans', { opacity: 0, duration: 0.2 }, 1.25)
        // 3. uitzwellen en iris open
        .to('.sl-welkom-merk', { scale: 1.14, opacity: 0, filter: 'blur(10px)', duration: 0.55, ease: 'power2.in' }, 1.32)
        .to('.sl-welkom-ring', { scale: 1.9, opacity: 0, duration: 0.6, ease: 'power2.in' }, 1.32)
        .to('.sl-welkom-gloed', { scale: 1.6, opacity: 0, duration: 0.6, ease: 'power2.in' }, 1.35)
        .fromTo('.sl-welkom-bg', { '--gat': 0 }, { '--gat': 105, duration: 0.8, ease: 'power3.inOut' }, 1.45)
        .to('.sl-welkom-skip', { opacity: 0, duration: 0.2 }, 1.3);
      if (main) tl.fromTo(main, { opacity: 0, y: 16, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: 'power3.out', clearProps: 'transform' }, 1.55);
      if (rail) tl.fromTo(rail, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' }, 1.65);
    }, laag);

    function afronden() {
      if (klaar) return;
      klaar = true;
      spelen.current = false;
      weg();
      ctx.revert();
      // main en rail (buiten de laag) altijd zichtbaar achterlaten, ook bij overslaan.
      for (const el of [main, rail]) if (el) gsap.set(el, { clearProps: 'opacity,transform' });
      shell?.classList.remove('sl-welkom-aan');
      laag?.removeAttribute('data-bezig');
    }
    const opToets = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      afronden();
    };
    const opKlik = () => afronden();
    function weg() {
      window.removeEventListener('keydown', opToets, true);
      laag?.removeEventListener('pointerdown', opKlik);
    }
    window.addEventListener('keydown', opToets, true);
    laag.addEventListener('pointerdown', opKlik);

    return () => {
      weg();
      ctx.revert();
      for (const el of [main, rail]) if (el) gsap.set(el, { clearProps: 'opacity,transform' });
      laag.removeAttribute('data-bezig');
      if (!klaar) shell.classList.remove('sl-welkom-aan');
    };
  }, []);

  return (
    <div ref={ref} className="sl-welkom" aria-hidden="true">
      <div className="sl-welkom-bg" />
      <div className="sl-welkom-gloed" />
      <div className="sl-welkom-merk">
        <svg className="sl-welkom-ring" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="48.5" pathLength={1} />
        </svg>
        <div className="sl-welkom-beeld">
          {Array.from({ length: STROKEN }, (_, i) => (
            <div
              key={i}
              className="sl-welkom-strook"
              style={{ clipPath: `inset(-2% ${(100 - ((i + 1) * 100) / STROKEN).toFixed(3)}% -2% ${((i * 100) / STROKEN).toFixed(3)}%)` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/merk-licht.png" alt="" width={592} height={594} />
            </div>
          ))}
          <span className="sl-welkom-glans" />
        </div>
      </div>
      <span className="sl-welkom-skip">Klik om over te slaan</span>
    </div>
  );
}
