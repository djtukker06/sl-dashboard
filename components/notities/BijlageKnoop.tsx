'use client';

import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { leesbareGrootte } from '@/lib/notities/kern';

// Een los bestand in een notitie (PDF, Word, Excel, zip …): een kaartje met naam, grootte en
// Openen/Downloaden. Foto's zijn een gewone afbeelding (extension-image). De src is altijd de
// eigen route /api/notities/<id>/bestanden/<id> (kern.ts schoont de rest weg), die na de
// toegangscontrole doorstuurt naar een signed URL.

function extensie(naam: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(naam);
  return m ? m[1].toUpperCase() : 'BESTAND';
}

function BijlageKaart({ node, selected }: NodeViewProps) {
  const { src, naam, grootte } = node.attrs as { src: string; naam: string; grootte: number };
  const ext = extensie(naam);
  return (
    <NodeViewWrapper className={`sp-bijlage${selected ? ' is-gekozen' : ''}`} data-drag-handle="">
      <span className={`sp-bijlage-icoon${ext.length > 4 ? ' is-lang' : ''}`} aria-hidden="true">
        {ext}
      </span>
      <span className="sp-bijlage-tekst">
        <span className="sp-bijlage-naam" title={naam}>
          {naam}
        </span>
        <span className="sp-bijlage-meta">{leesbareGrootte(grootte)}</span>
      </span>
      <a className="sp-bijlage-knop" href={src} target="_blank" rel="noopener noreferrer" contentEditable={false}>
        Openen
      </a>
      <a className="sp-bijlage-knop" href={`${src}?download=1`} aria-label={`${naam} downloaden`} contentEditable={false}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
      </a>
    </NodeViewWrapper>
  );
}

export const BijlageKnoop = Node.create({
  name: 'bijlage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      naam: { default: 'bestand' },
      type: { default: 'application/octet-stream' },
      grootte: { default: 0, parseHTML: (el) => Number(el.getAttribute('grootte')) || 0 }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-bijlage]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-bijlage': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BijlageKaart);
  }
});
