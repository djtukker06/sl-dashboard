'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { veiligeLink, type TiptapKnoop } from '@/lib/notities/kern';
import { uploadBijlage } from '@/lib/notities/client';
import { useToast } from '@/components/agenda/Toast';
import { BijlageKnoop } from './BijlageKnoop';

// De tekst van een notitie: Tiptap (ProseMirror) met koppen, lijsten, afvinklijstjes, citaat,
// code en scheidingslijn. Markdown-sneltoetsen ("# ", "- ", "1. ", "[ ] ", "> ", "```", "---")
// komen uit de starter-kit. Daarbij:
//   - een "/"-menu om een blok te kiezen (pijltjes + Enter, of verder typen om te filteren);
//   - een opmaakbalk bij een selectie (vet, cursief, onderstreept, doorhalen, code, link, kop).
// De inhoud is altijd Tiptap-JSON en wordt alleen door Tiptap getoond (geen losse HTML), dus
// geen ruimte voor ingevoegde scripts; links kunnen alleen http(s), mailto, tel of een eigen pad zijn.
//
// Foto's en bestanden (migratie 0032): via "/foto" of "/bestand", door te plakken (bv. een
// screenshot) of door ze in de tekst te slepen. Ze gaan rechtstreeks naar de privé-opslag; in
// de tekst komt een foto (te verkleinen aan de randen) of een bestandskaartje.

type Blok = {
  id: string;
  label: string;
  hint: string;
  /** Extra zoekwoorden (Nederlands en Engels). */
  woorden: string;
  icoon: string;
  doe: (e: Editor) => void;
  /** Opent de bestandskiezer in plaats van een blok te maken. */
  bijlage?: 'foto' | 'bestand';
};

const BIJLAGE_BLOKKEN: Blok[] = [
  { id: 'foto', label: 'Foto', hint: 'Afbeelding uploaden', woorden: 'foto afbeelding plaatje image beeld screenshot', icoon: '▣', doe: () => {}, bijlage: 'foto' },
  { id: 'bestand', label: 'Bestand', hint: 'PDF, Word, Excel … (max. 25 MB)', woorden: 'bestand bijlage file pdf document upload', icoon: '⎘', doe: () => {}, bijlage: 'bestand' }
];

const BLOKKEN: Blok[] = [
  { id: 'tekst', label: 'Tekst', hint: 'Gewone alinea', woorden: 'tekst text alinea paragraaf', icoon: 'T', doe: (e) => e.chain().focus().setParagraph().run() },
  { id: 'h1', label: 'Kop 1', hint: 'Grote kop  ·  #', woorden: 'kop titel heading h1', icoon: 'H1', doe: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Kop 2', hint: 'Middelgrote kop  ·  ##', woorden: 'kop heading h2 subkop', icoon: 'H2', doe: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Kop 3', hint: 'Kleine kop  ·  ###', woorden: 'kop heading h3', icoon: 'H3', doe: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { id: 'afvink', label: 'Afvinklijst', hint: 'To-do’s  ·  [ ]', woorden: 'afvinklijst todo taak taken checklist vink', icoon: '☐', doe: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'opsomming', label: 'Opsomming', hint: 'Lijst met bolletjes  ·  -', woorden: 'opsomming lijst bullet bolletjes', icoon: '•', doe: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'genummerd', label: 'Genummerde lijst', hint: '1, 2, 3  ·  1.', woorden: 'genummerd nummer lijst ordered nummering', icoon: '1.', doe: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'citaat', label: 'Citaat', hint: 'Uitgelicht citaat  ·  >', woorden: 'citaat quote blockquote', icoon: '“', doe: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'code', label: 'Code', hint: 'Codeblok  ·  ```', woorden: 'code codeblok snippet', icoon: '</>', doe: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'lijn', label: 'Scheidingslijn', hint: 'Horizontale lijn  ·  ---', woorden: 'scheidingslijn lijn divider streep hr', icoon: '—', doe: (e) => e.chain().focus().setHorizontalRule().run() }
];

function filterBlokken(q: string, metBijlagen: boolean): Blok[] {
  const alle = metBijlagen ? [...BLOKKEN, ...BIJLAGE_BLOKKEN] : BLOKKEN;
  const t = q.toLowerCase();
  if (!t) return alle;
  return alle.filter((b) => b.label.toLowerCase().includes(t) || b.woorden.includes(t));
}

type Upload = { id: number; naam: string };

type Slash = { van: number; tot: number; query: string; x: number; y: number; boven: boolean };

/** Staat de cursor direct na een "/" (aan het begin of na een spatie)? Dan het menu tonen. */
function zoekSlash(editor: Editor, genegeerd: number | null): Slash | null {
  const { selection } = editor.state;
  if (!selection.empty || !editor.isFocused) return null;
  const $van = selection.$from;
  if ($van.parent.type.name === 'codeBlock') return null;
  const voor = $van.parent.textBetween(0, $van.parentOffset, undefined, '￼');
  const m = /(?:^|\s)\/([\p{L}\p{N}]{0,24})$/u.exec(voor);
  if (!m) return null;
  const van = selection.from - m[1].length - 1;
  if (van === genegeerd) return null;
  const c = editor.view.coordsAtPos(selection.from);
  const hoogte = 330;
  const boven = c.bottom + hoogte > window.innerHeight - 8 && c.top > hoogte;
  return {
    van,
    tot: selection.from,
    query: m[1],
    x: Math.max(8, Math.min(c.left, window.innerWidth - 268)),
    y: boven ? c.top - 6 : c.bottom + 6,
    boven
  };
}

export function NotitieEditor({
  inhoud,
  notitieId,
  bewerkbaar = true,
  onWijziging,
  onKlaar,
  autofocus = false
}: {
  inhoud: TiptapKnoop;
  /** Zonder id: geen foto's of bestanden toevoegen. */
  notitieId?: string;
  bewerkbaar?: boolean;
  /** Bij elke wijziging van de inhoud (de ouder slaat met vertraging op). */
  onWijziging: () => void;
  /** De editor is klaar (of weg: null). */
  onKlaar?: (editor: Editor | null) => void;
  autofocus?: boolean;
}) {
  const toast = useToast();
  const [slash, setSlash] = useState<Slash | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const kiezer = useRef<HTMLInputElement>(null);
  /** Waar de bestanden uit de kiezer komen (positie in het document bij het openen). */
  const kiezerPos = useRef<number | null>(null);
  const metBijlagen = Boolean(notitieId) && bewerkbaar;
  const [actief, setActief] = useState(0);
  const slashRef = useRef<{ s: Slash | null; actief: number; lijst: Blok[] }>({ s: null, actief: 0, lijst: BLOKKEN });
  const genegeerd = useRef<number | null>(null);
  const metBijlagenRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const wijziging = useRef(onWijziging);
  useEffect(() => {
    wijziging.current = onWijziging;
  }, [onWijziging]);

  const lijst = slash ? filterBlokken(slash.query, metBijlagen) : [];
  useEffect(() => {
    slashRef.current = { s: slash, actief, lijst };
  });

  function kies(editor: Editor, b: Blok) {
    const s = slashRef.current.s;
    if (s) editor.chain().focus().deleteRange({ from: s.van, to: s.tot }).run();
    setSlash(null);
    if (b.bijlage) {
      openKiezer(b.bijlage, editor.state.selection.from);
      return;
    }
    b.doe(editor);
  }

  function openKiezer(soort: 'foto' | 'bestand', pos: number | null) {
    const k = kiezer.current;
    if (!k) return;
    k.accept = soort === 'foto' ? 'image/*' : '';
    kiezerPos.current = pos;
    k.click();
  }

  // Uploaden en daarna invoegen op de plek waar het bestand werd neergezet. Die plek schuift
  // mee met wat er intussen getypt wordt (transaction mapping).
  const volgnr = useRef(0);
  const plekken = useRef(new Map<number, number>());
  async function uploadBestanden(bestanden: File[], pos: number | null) {
    const ed = editorRef.current;
    if (!ed || !notitieId || !bestanden.length) return;
    let plek = pos ?? ed.state.selection.to;
    for (const f of bestanden) {
      const id = ++volgnr.current;
      plekken.current.set(id, plek);
      setUploads((u) => [...u, { id, naam: f.name }]);
      try {
        const b = await uploadBijlage(notitieId, f);
        const e = editorRef.current;
        if (!e || e.isDestroyed) return;
        const doel = Math.min(plekken.current.get(id) ?? e.state.doc.content.size, e.state.doc.content.size);
        const knoop = b.afbeelding
          ? { type: 'image', attrs: { src: b.url, alt: b.naam } }
          : { type: 'bijlage', attrs: { src: b.url, naam: b.naam, type: b.type, grootte: b.grootte } };
        e.chain().insertContentAt(doel, knoop).run();
        // Volgende bestand direct erna.
        plek = Math.min(e.state.selection.to, e.state.doc.content.size);
      } catch (err) {
        toast(err instanceof Error ? err.message : `Uploaden van “${f.name}” mislukt.`, { fout: true });
      } finally {
        plekken.current.delete(id);
        setUploads((u) => u.filter((x) => x.id !== id));
      }
    }
  }
  const uploadRef = useRef(uploadBestanden);
  useEffect(() => {
    uploadRef.current = uploadBestanden;
  });

  const editor = useEditor({
    // Geen server-render (geen hydration-verschil); de editor verschijnt direct na laden.
    immediatelyRender: false,
    editable: bewerkbaar,
    autofocus: autofocus ? 'end' : false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', isAllowedUri: (url) => veiligeLink(url) !== null }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({
        HTMLAttributes: { class: 'sp-foto', loading: 'lazy' },
        resize: { enabled: true, directions: ['left', 'right', 'bottom-left', 'bottom-right'], minWidth: 80, minHeight: 40, alwaysPreserveAspectRatio: true }
      }),
      BijlageKnoop,
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? 'Kop' : 'Schrijf iets, of typ “/” voor blokken…'),
        includeChildren: false
      })
    ],
    content: inhoud,
    editorProps: {
      attributes: { class: 'sp-tekst', 'aria-label': 'Inhoud van de notitie', spellcheck: 'true' },
      // Geplakte of gesleepte bestanden (bv. een screenshot) worden een bijlage.
      handlePaste: (_view, e) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (!files.length || !metBijlagenRef.current) return false;
        e.preventDefault();
        void uploadRef.current(files, null);
        return true;
      },
      handleDrop: (view, e, _slice, verplaatst) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (verplaatst || !files.length || !metBijlagenRef.current) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null;
        void uploadRef.current(files, pos);
        return true;
      },
      handleKeyDown: (_view, e) => {
        const { s, actief: a, lijst: l } = slashRef.current;
        if (!s) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (l.length) setActief((a + (e.key === 'ArrowDown' ? 1 : l.length - 1)) % l.length);
          return true;
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && l.length) {
          e.preventDefault();
          if (editorRef.current) kies(editorRef.current, l[a] ?? l[0]);
          return true;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          genegeerd.current = s.van;
          setSlash(null);
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: e }) => {
      wijziging.current();
      const s = zoekSlash(e, genegeerd.current);
      setSlash(s);
      if (!s) genegeerd.current = null;
      else if (s.query !== slashRef.current.s?.query) setActief(0);
    },
    onSelectionUpdate: ({ editor: e }) => {
      if (slashRef.current.s) setSlash(zoekSlash(e, genegeerd.current));
    },
    onBlur: () => setSlash(null),
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged || !plekken.current.size) return;
      for (const [id, p] of plekken.current) plekken.current.set(id, transaction.mapping.map(p));
    }
  });
  useEffect(() => {
    metBijlagenRef.current = metBijlagen;
  }, [metBijlagen]);
  useEffect(() => {
    editorRef.current = editor;
    onKlaar?.(editor);
    return () => onKlaar?.(null);
  }, [editor, onKlaar]);

  // Het menu sluit bij scrollen (anders zweeft het los van de cursor).
  useEffect(() => {
    if (!slash) return;
    const sluit = () => setSlash(null);
    window.addEventListener('scroll', sluit, true);
    window.addEventListener('resize', sluit);
    return () => {
      window.removeEventListener('scroll', sluit, true);
      window.removeEventListener('resize', sluit);
    };
  }, [slash]);

  if (!editor) return <div className="sp-tekst sp-tekst-laden" aria-busy="true" />;

  return (
    <>
      <OpmaakBalk editor={editor} />
      <EditorContent editor={editor} className="sp-editor" />
      {metBijlagen && (
        <input
          ref={kiezer}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            void uploadBestanden(files, kiezerPos.current);
          }}
        />
      )}
      {metBijlagen && (
        <button
          type="button"
          className="sp-bijlage-toevoegen"
          onClick={() => openKiezer('bestand', editor.state.doc.content.size)}
          title="Of sleep een bestand in de tekst, of plak een screenshot"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5 12.6 19.9a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
          </svg>
          Foto of bestand toevoegen
        </button>
      )}
      {uploads.length > 0 && (
        <div className="sp-uploads" role="status" aria-live="polite">
          {uploads.map((u) => (
            <span key={u.id} className="sp-upload">
              <span className="sp-upload-draai" aria-hidden="true" />
              {u.naam} uploaden…
            </span>
          ))}
        </div>
      )}
      {slash && (
        <div
          className={`sp-slash${slash.boven ? ' is-boven' : ''}`}
          style={{ left: slash.x, top: slash.y }}
          role="listbox"
          aria-label="Blok kiezen"
          onMouseDown={(e) => e.preventDefault()}
        >
          {lijst.length === 0 ? (
            <p className="sp-slash-leeg">Geen blok “{slash.query}”</p>
          ) : (
            <>
              <p className="sp-slash-kop">Blokken</p>
              {lijst.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  role="option"
                  aria-selected={i === actief}
                  className="sp-slash-optie"
                  onMouseEnter={() => setActief(i)}
                  onClick={() => kies(editor, b)}
                >
                  <span className="sp-slash-icoon" aria-hidden="true">
                    {b.icoon}
                  </span>
                  <span className="sp-slash-tekst">
                    <span className="sp-slash-label">{b.label}</span>
                    <span className="sp-slash-hint">{b.hint}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** De opmaakbalk boven een selectie (niet in een codeblok). */
function OpmaakBalk({ editor }: { editor: Editor }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      vet: e.isActive('bold'),
      cursief: e.isActive('italic'),
      onder: e.isActive('underline'),
      door: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 })
    })
  });

  function link() {
    const huidig = (editor.getAttributes('link').href as string | undefined) ?? '';
    const invoer = window.prompt('Link (leeg = link weghalen)', huidig || 'https://');
    if (invoer === null) return;
    const t = invoer.trim();
    if (!t || t === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const href = veiligeLink(/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(t) ? `https://${t}` : t);
    if (!href) {
      window.alert('Alleen links die beginnen met https://, http://, mailto: of tel:.');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }

  const knop = (label: string, aan: boolean, doe: () => void, inhoud: React.ReactNode, klasse = '') => (
    <button type="button" className={`sp-balk-knop${aan ? ' is-aan' : ''}${klasse ? ` ${klasse}` : ''}`} aria-pressed={aan} title={label} aria-label={label} onClick={doe}>
      {inhoud}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      className="sp-balk"
      shouldShow={({ editor: e, state }) => !state.selection.empty && e.isEditable && !e.isActive('codeBlock') && !(state.selection instanceof NodeSelection)}
    >
      {knop('Kop 1', st.h1, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), 'H1', 'is-tekst')}
      {knop('Kop 2', st.h2, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2', 'is-tekst')}
      <span className="sp-balk-streep" aria-hidden="true" />
      {knop('Vet (⌘B)', st.vet, () => editor.chain().focus().toggleBold().run(), <b>B</b>)}
      {knop('Cursief (⌘I)', st.cursief, () => editor.chain().focus().toggleItalic().run(), <i>I</i>)}
      {knop('Onderstrepen (⌘U)', st.onder, () => editor.chain().focus().toggleUnderline().run(), <u>U</u>)}
      {knop('Doorhalen', st.door, () => editor.chain().focus().toggleStrike().run(), <s>S</s>)}
      {knop('Code', st.code, () => editor.chain().focus().toggleCode().run(), <code>{'</>'}</code>)}
      <span className="sp-balk-streep" aria-hidden="true" />
      {knop(
        st.link ? 'Link wijzigen' : 'Link toevoegen',
        st.link,
        link,
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
      )}
    </BubbleMenu>
  );
}
