import sanitizeHtml from 'sanitize-html';

// Mail-HTML veilig maken (eerste linie; de tweede is de gesandboxte iframe met CSP in
// components/mail/VeiligeMailFrame.tsx).
//   - weg: script, iframe, object, embed, form-elementen, meta/link/base, on*-attributen,
//     javascript:/vbscript:-URL's;
//   - <style> en inline styles blijven, anders vallen opgemaakte mails uit elkaar;
//   - externe afbeeldingen (src/background met http(s)) worden data-extern-src /
//     data-extern-background, zodat er niets geladen wordt tot de gebruiker op "Tonen" klikt;
//   - cid:-afbeeldingen zijn door mailparser data:-URI's geworden (totaalbudget 1 MB); wat
//     daarboven viel is nog cid: en verdwijnt hier, omdat img alleen data/http(s) toestaat.

const TAGS = [
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption',
  'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'font', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li',
  'main', 'map', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strike', 'strong',
  'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul',
  'var', 'wbr'
];

const ALGEMEEN = [
  'style', 'class', 'id', 'title', 'dir', 'lang', 'align', 'valign', 'width', 'height', 'bgcolor', 'color',
  'border', 'role', 'aria-label', 'aria-hidden'
];

const EXTERN = /^\s*(https?:)?\/\//i;

export function saneerMailHtml(html: string): { html: string; externeBeelden: number } {
  let extern = 0;
  const schoon = sanitizeHtml(html, {
    allowedTags: TAGS,
    // <style> mag blijven (de iframe draait zonder scripts); sanitize-html waarschuwt daar
    // anders voor.
    allowVulnerableTags: true,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'textarea', 'option', 'noscript', 'title', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
    allowedAttributes: {
      '*': ALGEMEEN,
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'data-extern-src', 'usemap', 'hspace', 'vspace'],
      area: ['href', 'alt', 'shape', 'coords'],
      map: ['name'],
      font: ['face', 'size'],
      table: ['cellpadding', 'cellspacing', 'summary', 'data-extern-background'],
      td: ['colspan', 'rowspan', 'nowrap', 'data-extern-background'],
      th: ['colspan', 'rowspan', 'nowrap', 'scope'],
      col: ['span'],
      colgroup: ['span'],
      ol: ['start', 'type', 'reversed'],
      ul: ['type'],
      li: ['value'],
      blockquote: ['cite', 'type'],
      time: ['datetime'],
      details: ['open'],
      div: ['data-extern-background'],
      body: ['data-extern-background']
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['data', 'http', 'https'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'data-extern-src'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
      }),
      img: (tagName, attribs) => {
        const uit = { ...attribs };
        if (uit.src && EXTERN.test(uit.src)) {
          extern++;
          uit['data-extern-src'] = uit.src.trim().replace(/^\/\//, 'https://');
          delete uit.src;
        }
        return { tagName, attribs: uit };
      },
      // background="http://…" (oude tabel-opmaak) → pas laden na "Tonen".
      '*': (tagName, attribs) => {
        if (!attribs.background) return { tagName, attribs };
        const uit = { ...attribs };
        if (EXTERN.test(uit.background)) {
          extern++;
          uit['data-extern-background'] = uit.background.trim();
        }
        delete uit.background;
        return { tagName, attribs: uit };
      }
    }
  });

  // Externe url(...) in CSS tellen we ook mee; de CSP in de iframe blokkeert ze tot "Tonen".
  const cssUrls = schoon.match(/url\(\s*['"]?\s*(https?:)?\/\//gi);
  if (cssUrls) extern += cssUrls.length;

  return { html: schoon, externeBeelden: extern };
}
