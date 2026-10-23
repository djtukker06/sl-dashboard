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

  // ---- mail-badge: aantal ongelezen in de inbox op het Mail-item van de rail.
  // /api/mail/status opent een IMAP-verbinding; daarom 60 s cache in sessionStorage
  // (gedeeld met de mailpagina en de dashboard-widget, die "sl-mail-ongelezen" sturen).
  // Per gebruiker (data-gebruiker op de rail): wie op dezelfde computer inlogt als een
  // ander teamlid, ziet nooit diens aantal. Bij uitloggen wordt de cache geleegd.
  const gebruiker = document.querySelector(".sl-rail[data-gebruiker]")?.getAttribute("data-gebruiker") || "";
  const MAIL_CACHE = gebruiker ? `sl-mail-status:${gebruiker}` : "sl-mail-status";
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !/\/auth\/uitloggen$/.test(form.getAttribute("action") || "")) return;
    try {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith("sl-")) sessionStorage.removeItem(k);
    } catch {
      /* geen opslag */
    }
  });
  const MAIL_MS = 60_000;
  // Geen mailbox gekoppeld (bv. een nieuw teamlid): niet elke 2 minuten opnieuw vragen.
  // Koppelen via /account of /welkom wist deze cache (MailboxSnelKoppelen).
  const GEEN_MAIL_MS = 15 * 60_000;
  const leesStatus = () => {
    try {
      const ruw = sessionStorage.getItem(MAIL_CACHE);
      if (!ruw) return null;
      const { t, v } = JSON.parse(ruw);
      return Date.now() - t < (v && v.geconfigureerd === false ? GEEN_MAIL_MS : MAIL_MS) ? v : null;
    } catch {
      return null;
    }
  };
  const schrijfStatus = (v) => {
    try {
      sessionStorage.setItem(MAIL_CACHE, JSON.stringify({ t: Date.now(), v }));
    } catch {
      /* geen opslag: dan zonder cache */
    }
  };
  const toonBadge = (aantal) => {
    for (const a of document.querySelectorAll('.sl-rail-item[href="/mail"]')) {
      let badge = a.querySelector(".sl-rail-badge");
      if (!aantal) {
        badge?.remove();
        a.removeAttribute("aria-label");
        continue;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "sl-rail-badge";
        badge.setAttribute("aria-hidden", "true");
        a.appendChild(badge);
      }
      badge.textContent = aantal > 99 ? "99+" : String(aantal);
      a.setAttribute("aria-label", `Mail, ${aantal} ongelezen`);
    }
  };
  let mailBezig = false;
  const ververs = async (forceer) => {
    if (!document.querySelector('.sl-rail-item[href="/mail"]')) return;
    const cache = forceer ? null : leesStatus();
    if (cache) return toonBadge(cache.geconfigureerd ? cache.ongelezen : 0);
    if (mailBezig) return;
    mailBezig = true;
    try {
      const res = await fetch("/api/mail/status", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return; // bv. 401 of mailserver onbereikbaar: badge gewoon niet tonen
      const v = await res.json();
      schrijfStatus(v);
      toonBadge(v.geconfigureerd ? v.ongelezen : 0);
    } catch {
      /* offline: niets tonen */
    } finally {
      mailBezig = false;
    }
  };
  window.addEventListener("sl-mail-ongelezen", (e) => toonBadge(Number(e.detail) || 0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ververs(false);
  });
  // Elke 2 minuten (alleen als het tabblad zichtbaar is); de cache voorkomt dubbel werk.
  setInterval(() => {
    if (document.visibilityState === "visible") ververs(false);
  }, 120_000);
  // Op /mail en het dashboard haalt de pagina zelf het aantal op (en meldt het via het
  // event); daar wachten we even zodat er niet twee IMAP-verbindingen tegelijk opengaan.
  const eigenOphaler = location.pathname === "/mail" || location.pathname === "/";
  setTimeout(() => ververs(false), eigenOphaler ? 4000 : 0);

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
