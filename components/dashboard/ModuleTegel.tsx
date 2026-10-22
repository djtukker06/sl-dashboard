import Link from 'next/link';
import type { Module } from '@/lib/modules';
import { ModuleIcoon } from './ModuleIcoon';

export function ModuleTegel({ module }: { module: Module }) {
  return (
    // prefetch uit: /social is een statisch HTML-document (geen React-route).
    <Link href={module.href} className="dash-tegel" prefetch={false}>
      <ModuleIcoon naam={module.icoon} />
      <span className="dash-tegel-naam">{module.naam}</span>
      <span className="dash-tegel-tekst">{module.beschrijving}</span>
      <span className="dash-tegel-pijl" aria-hidden="true">
        Openen &rarr;
      </span>
    </Link>
  );
}
