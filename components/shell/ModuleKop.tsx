// Kop van een module-pagina in de shell: 96px hoog, op één lijn met het logo in de rail
// (zelfde maat als de kop van de social-module).
export function ModuleKop({
  label,
  titel,
  children
}: {
  label?: React.ReactNode;
  titel: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="sl-kop">
      <div className="sl-kop-tekst">
        {label && <p className="sl-kop-label">{label}</p>}
        <h1 className="sl-kop-titel">{titel}</h1>
      </div>
      {children && <div className="sl-kop-acties">{children}</div>}
    </header>
  );
}
