'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BoekhoudingKop } from './BoekhoudingKop';

// Kop van alle facturenschermen (/facturen/*), in app/(app)/facturen/layout.tsx en in het
// laadscherm: dezelfde Boekhouding-kop als de andere modules. De titel en de knoppen rechts
// hangen af van het scherm; zo hebben de facturenschermen zelf geen eigen wordmark, topbar
// of grote titel meer (dat was een dubbele kop onder de modulekop).
//   /facturen                      Facturen     · Prijsopgaven, + Nieuwe factuur
//   /facturen/prijsopgaven         Prijsopgaven · + Nieuwe prijsopgave
//   /facturen/prijsopgaven/…       Prijsopgaven
//   /facturen/klanten/<id>         Facturen     · + Nieuwe factuur
//   overige (nieuw, bewerken)      Facturen
export function FacturenKop() {
  const pad = (usePathname() || '/facturen').replace(/\/+$/, '');
  const prijsopgaven = pad === '/facturen/prijsopgaven' || pad.startsWith('/facturen/prijsopgaven/');

  let acties: React.ReactNode = null;
  if (pad === '/facturen') {
    acties = (
      <>
        <Link className="db-knop" href="/facturen/prijsopgaven">
          Prijsopgaven
        </Link>
        <Link className="db-knop db-knop-primair" href="/facturen/nieuwe-factuur">
          + Nieuwe factuur
        </Link>
      </>
    );
  } else if (pad === '/facturen/prijsopgaven') {
    acties = (
      <Link className="db-knop db-knop-primair" href="/facturen/prijsopgaven/nieuw">
        + Nieuwe prijsopgave
      </Link>
    );
  } else if (pad.startsWith('/facturen/klanten/')) {
    acties = (
      <Link className="db-knop db-knop-primair" href="/facturen/nieuwe-factuur">
        + Nieuwe factuur
      </Link>
    );
  }

  return (
    <BoekhoudingKop
      titel={
        prijsopgaven ? (
          <Link href="/facturen/prijsopgaven" className="sl-kop-link">
            Prijsopgaven
          </Link>
        ) : (
          <Link href="/facturen" className="sl-kop-link">
            Facturen
          </Link>
        )
      }
    >
      {acties}
    </BoekhoudingKop>
  );
}
