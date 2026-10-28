'use client';

import Link from 'next/link';
import { dagTekst, duurTekst } from '@/lib/agenda/datum';
import { magTaakWijzigen } from '@/lib/agenda/rechten';
import type { Taak } from '@/lib/agenda/types';
import { Persoon } from '@/components/team/Persoon';
import { useTeam } from '@/components/team/TeamProvider';

/** Ronde afvinkknop in de huisstijl (toetsenbord: spatie/enter). */
export function Afvinker({ taak, onToggle, klein }: { taak: Taak; onToggle: (t: Taak) => void; klein?: boolean }) {
  const { mijnId, overgang } = useTeam();
  const mag = magTaakWijzigen(taak, mijnId, overgang);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={taak.afgerond}
      aria-label={taak.afgerond ? `‘${taak.titel}’ weer openzetten` : `‘${taak.titel}’ afvinken`}
      disabled={!mag}
      title={mag ? undefined : 'Alleen de maker of wie de taak heeft gekregen, kan hem afvinken'}
      className={`ag-vink${klein ? ' ag-vink-klein' : ''}${taak.prioriteit === 1 ? ' ag-vink-hoog' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(taak);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function TaakMeta({ taak, vandaag, toonDatum }: { taak: Taak; vandaag: string; toonDatum: boolean }) {
  const { mijnId } = useTeam();
  const delen: string[] = [];
  if (toonDatum && taak.datum) delen.push(dagTekst(taak.datum, vandaag));
  if (taak.tijd) delen.push(taak.tijd);
  if (taak.duur && taak.tijd) delen.push(duurTekst(taak.duur));
  const sub = taak.subtaken.totaal > 0;
  const van = taak.aangemaaktDoor && taak.aangemaaktDoor !== mijnId && !taak.toegewezen.every((id) => id === taak.aangemaaktDoor);
  const afDoor = taak.afgerond && taak.afgerondDoor && taak.afgerondDoor !== mijnId;
  if (!delen.length && !taak.klantNaam && !taak.projectNaam && !taak.notitie && !sub && !van && !afDoor) return null;
  return (
    <span className="ag-taak-meta">
      {delen.length > 0 && <span>{delen.join(' · ')}</span>}
      {sub && (
        <span
          className={`ag-taak-sub${taak.subtaken.klaar === taak.subtaken.totaal ? ' is-klaar' : ''}`}
          aria-label={`${taak.subtaken.klaar} van ${taak.subtaken.totaal} subtaken klaar`}
        >
          {taak.subtaken.klaar}/{taak.subtaken.totaal}
        </span>
      )}
      {taak.projectNaam ? (
        <span className="ag-chip tk-chip-project ag-chip-mini" title={taak.klantNaam ? `${taak.projectNaam} · ${taak.klantNaam}` : taak.projectNaam}>
          {taak.projectNaam}
        </span>
      ) : (
        taak.klantNaam && <span className="ag-chip ag-chip-klant ag-chip-mini">{taak.klantNaam}</span>
      )}
      {taak.notitie && (
        <svg className="ag-notitie-icoon" viewBox="0 0 16 16" width="12" height="12" aria-label="Heeft een toelichting">
          <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
      {afDoor ? (
        <Persoon id={taak.afgerondDoor} voorvoegsel="afgerond door" className="ag-taak-van" />
      ) : (
        van && <Persoon id={taak.aangemaaktDoor} voorvoegsel="van" className="ag-taak-van" />
      )}
    </span>
  );
}

/** Mini-avatars van de toegewezenen (zonder jezelf, tenzij je `metMij` vraagt). */
export function Toegewezenen({ ids, metMij = false, max = 3 }: { ids: string[]; metMij?: boolean; max?: number }) {
  const { mijnId } = useTeam();
  const lijst = metMij ? ids : ids.filter((id) => id !== mijnId);
  if (!lijst.length) return null;
  return (
    <span className="ag-wie" aria-label={`Ook voor: ${lijst.length} ${lijst.length === 1 ? 'persoon' : 'personen'}`}>
      {lijst.slice(0, max).map((id) => (
        <Persoon key={id} id={id} compact voorvoegsel="voor" />
      ))}
      {lijst.length > max && <span className="ag-wie-meer">+{lijst.length - max}</span>}
    </span>
  );
}

/** Eén taak in een lijst: afvinken, titel, datum/tijd, klant en prioriteit. */
export function TaakRij({
  taak,
  vandaag,
  onToggle,
  onOpen,
  href,
  toonDatum = true,
  versleepbaar = false
}: {
  taak: Taak;
  vandaag: string;
  onToggle: (t: Taak) => void;
  onOpen?: (t: Taak) => void;
  href?: string;
  toonDatum?: boolean;
  versleepbaar?: boolean;
}) {
  const teLaat = !taak.afgerond && !!taak.datum && taak.datum < vandaag;
  const prio = taak.prioriteit === 1 ? ' is-prio-hoog' : taak.prioriteit === 3 ? ' is-prio-laag' : '';
  const klasse = `ag-taak${taak.afgerond ? ' is-af' : ''}${teLaat ? ' is-telaat' : ''}${taak.afgerond ? '' : prio}`;
  const inhoud = (
    <>
      <span className="ag-taak-titel">{taak.titel}</span>
      <TaakMeta taak={taak} vandaag={vandaag} toonDatum={toonDatum} />
    </>
  );
  return (
    <li
      className={klasse}
      draggable={versleepbaar && !taak.afgerond}
      onDragStart={
        versleepbaar
          ? (e) => {
              e.dataTransfer.setData('application/x-sl-taak', taak.id);
              e.dataTransfer.effectAllowed = 'move';
            }
          : undefined
      }
    >
      <Afvinker taak={taak} onToggle={onToggle} />
      {href ? (
        <Link className="ag-taak-hoofd" href={href}>
          {inhoud}
        </Link>
      ) : (
        <button type="button" className="ag-taak-hoofd" onClick={() => onOpen?.(taak)}>
          {inhoud}
        </button>
      )}
      <Toegewezenen ids={taak.toegewezen} />
      {taak.prioriteit !== 2 && !taak.afgerond && (
        <span className={`ag-prio ag-prio-${taak.prioriteit === 1 ? 'hoog' : 'laag'}`} title={taak.prioriteit === 1 ? 'Urgentie hoog' : 'Urgentie laag'}>
          {taak.prioriteit === 1 && (
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
              <path d="M8 2.5v7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="8" cy="13" r="1.3" fill="currentColor" />
            </svg>
          )}
          {taak.prioriteit === 1 ? 'Urgent' : 'Laag'}
        </span>
      )}
    </li>
  );
}
