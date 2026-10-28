// Direct zichtbaar bij het wisselen van tabblad: de rail blijft staan en dit skelet vult de
// inhoud tot de pagina er is (de server streamt hem daarna in). Dankzij deze grens haalt Next
// de shell van een tabblad ook al vooraf op (prefetch) zodra de link in beeld is.
export default function Laden() {
  return (
    <div className="sl-laden" aria-busy="true" aria-label="Laden…">
      <header className="sl-kop">
        <div className="sl-kop-tekst">
          <div className="db-skelet sl-laden-label" />
          <div className="db-skelet db-skelet-groot sl-laden-titel" />
        </div>
      </header>
      <div className="sl-laden-inhoud">
        {[92, 78, 85, 64, 88, 70].map((b, i) => (
          <div key={i} className="db-skelet" style={{ width: `${b}%` }} />
        ))}
      </div>
    </div>
  );
}
