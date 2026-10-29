// Welkomstanimatie na het inloggen (components/shell/Welkomstanimatie.tsx). Het inlogformulier
// en de 2FA-stap zetten dit tijdstempel in sessionStorage; de app-shell speelt de animatie als
// het vers is (< 2 min) en wist het meteen, zodat herladen of een volgend tabblad hem niet
// opnieuw toont.

export const WELKOM_SLEUTEL = 'sl-welkom';
export const WELKOM_GELDIG_MS = 120_000;

export function markeerWelkom(): void {
  try {
    sessionStorage.setItem(WELKOM_SLEUTEL, String(Date.now()));
  } catch {
    /* geen opslag (privévenster): dan geen animatie */
  }
}

/** Inline script in de shell (tijdens het parsen, vóór de eerste paint): klasse sl-welkom-aan. */
export const WELKOM_SCRIPT = `(function(){try{var d=document.currentScript&&document.currentScript.parentElement,t=+sessionStorage.getItem('${WELKOM_SLEUTEL}');if(!d||!t||Date.now()-t>${WELKOM_GELDIG_MS})return;if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;d.classList.add('sl-welkom-aan')}catch(e){}})();`;
