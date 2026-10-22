import Link from 'next/link';

// Navitem terug naar het overkoepelende dashboard. Staat als eerste item in de
// bestaande topbar-nav van elke module en gebruikt de bestaande `.topbar nav a`-stijl.
export function DashboardLink() {
  return <Link href="/">Dashboard</Link>;
}
