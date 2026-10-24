'use client';

import { TfaInstellen } from './TfaInstellen';

// Losse pagina "2FA instellen" (verplicht) in de stijl van de welkomstflow.
export function TfaVerplicht({ voornaam, vervolg }: { voornaam: string; vervolg: string }) {
  return (
    <div className="wk">
      <div className="wk-kaart">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="wk-logo" src="/brand/banner-licht.png" alt="Studio Levant" width={800} height={297} />
        <div className="wk-blok">
          <h1 className="wk-titel">Beveilig je account{voornaam ? `, ${voornaam}` : ''}</h1>
          <p className="wk-tekst">
            In de backoffice staan facturen, klantgegevens en mail. Daarom vragen we naast je wachtwoord een code uit
            een app op je telefoon: tweestapsverificatie. Dat duurt een minuut.
          </p>
          <TfaInstellen naam="Telefoon" onKlaar={() => (window.location.href = vervolg)} />
          <p className="wk-tekst wk-klein">
            Tip: voeg daarna via Account een tweede apparaat toe (bv. je wachtwoordmanager). Dan kom je er ook in als je
            telefoon kwijt is.
          </p>
        </div>
        <form method="post" action="/auth/uitloggen">
          <button type="submit" className="bv-link">
            Uitloggen
          </button>
        </form>
      </div>
    </div>
  );
}
