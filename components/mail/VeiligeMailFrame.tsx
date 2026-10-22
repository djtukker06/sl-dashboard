'use client';

import { useMemo } from 'react';

// Toont (al op de server gesaneerde) mail-HTML in een afgeschermde iframe:
//   - sandbox zonder allow-scripts en zonder allow-same-origin: geen JavaScript, geen
//     toegang tot cookies/opslag van de backoffice, formulieren werken niet;
//   - allow-popups(-to-escape-sandbox): links openen in een nieuw, normaal tabblad;
//   - CSP in de srcdoc: alleen inline stijlen en data:-afbeeldingen; externe afbeeldingen
//     (https:) pas na een klik op "Tonen";
//   - <base target="_blank"> en referrer-policy no-referrer: niets lekt naar de afzender.
// De iframe vult het leesvenster en scrollt zelf.

const BASIS_CSS = `
html,body{margin:0;padding:0;background:#fff}
body{padding:28px 32px 40px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f1f1f;word-wrap:break-word;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
img:not([src]){display:none}
table{max-width:100%}
pre{white-space:pre-wrap}
blockquote{margin:0 0 0 .6em;padding-left:.9em;border-left:2px solid #d8d4d1;color:#555}
a{color:#2457c5}
@media (max-width:600px){body{padding:18px 16px 28px}}
`;

export function VeiligeMailFrame({ html, beeldenTonen, titel }: { html: string; beeldenTonen: boolean; titel: string }) {
  const srcDoc = useMemo(() => {
    const inhoud = beeldenTonen
      ? html.replace(/ data-extern-src="/g, ' src="').replace(/ data-extern-background="/g, ' background="')
      : html;
    const imgSrc = beeldenTonen ? 'data: https: http:' : 'data:';
    const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:; media-src 'none'; form-action 'none'; base-uri 'none'`;
    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      '<meta name="referrer" content="no-referrer">' +
      '<base target="_blank">' +
      `<style>${BASIS_CSS}</style></head><body>${inhoud}</body></html>`
    );
  }, [html, beeldenTonen]);

  return (
    <iframe
      className="ml-frame"
      title={titel}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
    />
  );
}
