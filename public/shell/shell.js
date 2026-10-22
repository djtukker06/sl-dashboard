// Studio Levant — gedrag van de gedeelde shell. Eén vanilla script voor alle pagina's:
// React (app/(app)/layout.tsx) en social (ingevoegd door app/social/route.ts).
// Bewust zonder afhankelijkheden en idempotent (mag twee keer geladen worden).
(() => {
  if (window.__slShell) return;
  window.__slShell = true;

  // ---- accountmenu (<details>): sluiten bij klik buiten het menu of met Escape
  document.addEventListener("click", (e) => {
    for (const d of document.querySelectorAll("details.sl-account[open]")) {
      if (!d.contains(e.target)) d.removeAttribute("open");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector("details.sl-account[open]");
    if (!open) return;
    open.removeAttribute("open");
    open.querySelector("summary")?.focus();
  });

  // ---- social: /social#nieuw (snelle actie op het dashboard) opent "Nieuwe post".
  // De hash wordt hier al gelezen: app.js vervangt hem bij het opstarten door #p=<id>.
  if (location.pathname === "/social" && location.hash === "#nieuw") {
    history.replaceState(null, "", location.pathname);
    let gedaan = false;
    const open = () => {
      if (gedaan) return;
      gedaan = true;
      const btn = document.getElementById("newProject");
      if (btn && !document.getElementById("newDialog")?.open) btn.click();
    };
    // Dit script draait (defer) vóór app.js (module); DOMContentLoaded komt pas ná app.js
    // en dus ná bindEvents(). "load" is het vangnet als DOMContentLoaded al geweest is.
    if (document.readyState === "complete") open();
    else {
      document.addEventListener("DOMContentLoaded", open, { once: true });
      window.addEventListener("load", open, { once: true });
    }
  }
})();
