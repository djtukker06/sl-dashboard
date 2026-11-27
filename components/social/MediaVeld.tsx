'use client';

import { useRef, useState } from 'react';
import { MAX_ALT_TEKST } from '@/lib/social/kern';
import { verhoudingLabel } from '@/lib/social/weergave';
import type { MediaDto, PostSoort } from '@/lib/social/types';
import { Icoon } from './Iconen';

export interface UploadItem {
  sleutel: string;
  naam: string;
  /** 0–1 */
  voortgang: number;
  fout: string | null;
}

const duurTekst = (s: number | null) => (s == null ? '' : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s)} s`);

// Media van een post: slepen of kiezen, volgorde (slepen of pijltjes), alt-tekst per beeld,
// voorbeeld. De controle per bestand (formaat, beeldverhouding, duur) gebeurt vóór de upload
// in de editor (controleerBestand uit lib/social/kern.ts).
export function MediaVeld({
  soort,
  media,
  lokaal,
  uploads,
  bewerkbaar,
  onBestanden,
  onWeg,
  onVerplaats,
  onAlt,
  onUploadWeg
}: {
  soort: PostSoort;
  media: MediaDto[];
  lokaal: Record<string, string>;
  uploads: UploadItem[];
  bewerkbaar: boolean;
  onBestanden: (f: File[]) => void;
  onWeg: (m: MediaDto) => void;
  onVerplaats: (van: number, naar: number) => void;
  onAlt: (m: MediaDto, tekst: string) => void;
  onUploadWeg: (sleutel: string) => void;
}) {
  const invoer = useRef<HTMLInputElement>(null);
  const [sleep, setSleep] = useState(false);
  const [sleepIndex, setSleepIndex] = useState<number | null>(null);
  const accept = soort === 'reel' ? 'video/mp4,video/quicktime' : soort === 'foto' ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
  const meer = soort === 'carrousel' || media.length === 0;

  return (
    <div className="so-media">
      {media.length > 0 && (
        <ol className="so-media-lijst">
          {media.map((m, i) => {
            const bron = lokaal[m.id] ?? m.url;
            return (
              <li
                key={m.id}
                className={`so-media-item${sleepIndex === i ? ' is-sleep' : ''}`}
                draggable={bewerkbaar && media.length > 1}
                onDragStart={(e) => {
                  setSleepIndex(i);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (sleepIndex != null) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (sleepIndex == null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onVerplaats(sleepIndex, i);
                  setSleepIndex(null);
                }}
                onDragEnd={() => setSleepIndex(null)}
              >
                <div className="so-media-beeld">
                  {bron && m.type === 'afbeelding' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URL of lokaal voorbeeld
                    <img src={bron} alt={m.alt_tekst} />
                  ) : bron && m.type === 'video' ? (
                    <video src={bron} muted playsInline preload="metadata" aria-label={m.alt_tekst || 'Video'} />
                  ) : (
                    <span className="so-thumb-leeg">
                      <Icoon naam={m.type === 'video' ? 'video' : 'beeld'} grootte={22} />
                    </span>
                  )}
                  <span className="so-media-nr">{i + 1}</span>
                </div>
                <div className="so-media-info">
                  <span className="so-zacht">
                    {m.type === 'video' ? `Video ${duurTekst(m.duur_sec)}` : 'Afbeelding'}
                    {m.breedte && m.hoogte ? ` · ${m.breedte}×${m.hoogte}` : ''}
                    {verhoudingLabel(m.breedte, m.hoogte) ? ` · ${verhoudingLabel(m.breedte, m.hoogte)}` : ''}
                  </span>
                  {m.type === 'afbeelding' && (
                    <input
                      className="ag-veld so-alt"
                      defaultValue={m.alt_tekst}
                      maxLength={MAX_ALT_TEKST}
                      placeholder="Alt-tekst (beschrijving voor schermlezers)"
                      aria-label={`Alt-tekst bestand ${i + 1}`}
                      onBlur={(e) => onAlt(m, e.target.value.trim())}
                      disabled={!bewerkbaar}
                    />
                  )}
                  {bewerkbaar && (
                    <div className="so-media-knoppen">
                      {media.length > 1 && (
                        <>
                          <button type="button" className="ag-icoonknop" aria-label="Naar voren" disabled={i === 0} onClick={() => onVerplaats(i, i - 1)}>
                            <Icoon naam="omhoog" />
                          </button>
                          <button type="button" className="ag-icoonknop" aria-label="Naar achteren" disabled={i === media.length - 1} onClick={() => onVerplaats(i, i + 1)}>
                            <Icoon naam="omlaag" />
                          </button>
                        </>
                      )}
                      <button type="button" className="ag-link-knop ag-link-gevaar" onClick={() => onWeg(m)}>
                        Weghalen
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {uploads.length > 0 && (
        <ul className="ug-wachtrij so-uploads">
          {uploads.map((u) => (
            <li key={u.sleutel} className={`ug-wacht ${u.fout ? 'is-fout' : 'is-uploaden'}`}>
              <span className="ug-wacht-stip" />
              <span className="ug-wacht-naam">{u.naam}</span>
              <span className="ug-wacht-fase">{u.fout ?? `${Math.round(u.voortgang * 100)}%`}</span>
              {u.fout && (
                <button type="button" className="ag-chip-x" aria-label="Melding sluiten" onClick={() => onUploadWeg(u.sleutel)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {bewerkbaar && meer && (
        <div
          className={`ug-drop so-drop${sleep ? ' is-sleep' : ''}`}
          onDragOver={(e) => {
            if (sleepIndex != null || !e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setSleep(true);
          }}
          onDragLeave={() => setSleep(false)}
          onDrop={(e) => {
            if (sleepIndex != null) return;
            e.preventDefault();
            setSleep(false);
            onBestanden([...e.dataTransfer.files]);
          }}
        >
          <div className="ug-drop-inhoud">
            <span className="ug-drop-icoon">
              <Icoon naam={soort === 'reel' ? 'video' : 'beeld'} grootte={28} />
            </span>
            <div className="ug-drop-tekst">
              <p className="ug-drop-titel">{soort === 'reel' ? 'Sleep een video hierheen' : media.length ? 'Nog een bestand toevoegen' : 'Sleep foto’s of een video hierheen'}</p>
              <p className="ug-drop-sub">
                {soort === 'reel'
                  ? 'MP4 of MOV, 3 s tot 15 min, het liefst 9:16 staand. Max. 50 MB.'
                  : 'JPEG, PNG of WebP (wordt JPEG voor Instagram), beeldverhouding 4:5 staand t/m 1,91:1 liggend. Video: MP4 of MOV.'}
              </p>
            </div>
            <div className="ug-drop-knoppen">
              <button type="button" className="db-knop" onClick={() => invoer.current?.click()}>
                Kies bestand{soort === 'carrousel' ? 'en' : ''}
              </button>
            </div>
          </div>
          <input
            ref={invoer}
            type="file"
            hidden
            accept={accept}
            multiple={soort === 'carrousel' || media.length === 0}
            onChange={(e) => {
              const lijst = [...(e.target.files ?? [])];
              e.target.value = '';
              onBestanden(lijst);
            }}
          />
        </div>
      )}
    </div>
  );
}
