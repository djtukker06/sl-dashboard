// Privacymodus ("cijfers verbergen"): vervaagt alle bedragen in de app, voor als je bv. in de
// trein werkt. De keuze staat per apparaat in localStorage; het inline script zet het attribuut
// data-privacy op <html> al tijdens het parsen, zodat bedragen ook bij het laden nooit even
// zichtbaar zijn. Gedrag en schakelaar: components/shell/Privacymodus.tsx; stijl: app.css.

export const PRIVACY_SLEUTEL = 'sl-privacy';
export const PRIVACY_ATTR = 'data-privacy';

/** Inline script in de shell (vóór de eerste paint). */
export const PRIVACY_SCRIPT = `(function(){try{if(localStorage.getItem('${PRIVACY_SLEUTEL}')==='1')document.documentElement.setAttribute('${PRIVACY_ATTR}','')}catch(e){}})();`;

/**
 * Herkent een bedrag in een stukje tekst: alles met een euroteken, of een Nederlands
 * decimaal getal met twee cijfers achter de komma ("1.234,56", "−12,50").
 */
export const BEDRAG_RE = /€|[−-]?\b\d{1,3}(?:\.\d{3})*,\d{2}\b/;
