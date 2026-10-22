// Levant Social Studio — frontend
// dashboard: binnen het Studio Levant Dashboard draait de API onder /api/social en
// staan de slide-bestanden onder /social-files (zie README "Studio Levant Dashboard").
const API_BASE = "/api/social"; // dashboard:
const FILES_BASE = "/social-files"; // dashboard:
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // dashboard: vangnet; grotere beelden dan 5 MB gaan alleen niet mee naar Claude
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  formats: {},
  projects: [],
  project: null,
  generating: false,
  abort: null,
  editor: null, // {file, index, mode, original, dirty}
  reviseFile: null,
  reviseDraft: null, // {file, feedback} na een mislukte aanpassing
};

// ---------------------------------------------------------------- helpers

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg = (data && data.error) || (typeof data === "string" && data) || `Fout ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", Boolean(isError));
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}

function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
  // Alleen uitvoeren als er nog iets in de wacht staat
  wrapped.flush = () => {
    if (t === null) return;
    clearTimeout(t);
    t = null;
    return fn();
  };
  return wrapped;
}

const fmt = (key) => state.formats[key] || { label: key, w: 1080, h: 1350 };
const pad = (n) => String(n).padStart(2, "0");
const projectUrl = (suffix = "") => `${API_BASE}/projects/${encodeURIComponent(state.project.id)}${suffix}`; // dashboard: API_BASE
const slideApi = (file, suffix = "") => projectUrl(`/slides/${encodeURIComponent(file)}${suffix}`);
const slideSrc = (file) =>
  `${FILES_BASE}/projects/${encodeURIComponent(state.project.id)}/slides/${encodeURIComponent(file)}?v=${encodeURIComponent(state.project.updatedAt || Date.now())}`; // dashboard: FILES_BASE

function download(href) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------- opstart

async function init() {
  bindEvents();
  try {
    const status = await api("GET", `${API_BASE}/status`); // dashboard: API_BASE
    state.formats = status.formats || {};
    const options = Object.entries(state.formats)
      .map(([key, f]) => `<option value="${escapeHtml(key)}">${escapeHtml(`${f.label} — ${f.w}×${f.h}`)}</option>`)
      .join("");
    $("#projectFormat").innerHTML = options;
    $("#newFormat").innerHTML = options;
    updateKeyStatus(status.hasKey);
    if (!status.hasKey) {
      toast("Stel eerst een Anthropic API-key in.", true);
      $("#settingsDialog").showModal();
    }
    if (!status.chrome) toast("Google Chrome niet gevonden: exporteren werkt niet.", true);
  } catch (err) {
    toast(err.message, true);
  }
  await loadProjects();
  const fromHash = hashId();
  if (fromHash && state.projects.some((p) => p.id === fromHash)) await openProject(fromHash);
  else if (state.projects.length) await openProject(state.projects[0].id);
  else showEmpty();
}

function hashId() {
  const m = location.hash.match(/p=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function updateKeyStatus(hasKey) {
  // dashboard: de key staat als omgevingsvariabele op de server; hier alleen de status
  $("#keyStatus").textContent = hasKey
    ? "Er is een API-key ingesteld op de server."
    : "Er is nog geen API-key ingesteld op de server.";
}

// ---------------------------------------------------------------- sidebar

async function loadProjects() {
  try {
    state.projects = await api("GET", `${API_BASE}/projects`); // dashboard: API_BASE
  } catch (err) {
    toast(err.message, true);
    state.projects = [];
  }
  renderProjectList();
}

function renderProjectList() {
  const q = $("#search").value.trim().toLowerCase();
  const activeId = state.project?.id;
  $("#projectList").innerHTML = state.projects
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .map((p) => {
      const n = p.slides?.length || 0;
      const meta = `${fmt(p.format).label} · ${n} ${n === 1 ? "slide" : "slides"} · ${formatDate(p.updatedAt)}`;
      return `<a data-id="${escapeHtml(p.id)}" class="${p.id === activeId ? "active" : ""}">
        <span>${escapeHtml(p.name)}</span><span class="mono">${escapeHtml(meta)}</span></a>`;
    })
    .join("");
}

// Houd de sidebar-entry van het open project actueel zonder opnieuw te laden
function syncListEntry() {
  const p = state.project;
  if (!p) return;
  const entry = { id: p.id, name: p.name, format: p.format, slides: p.slides, updatedAt: p.updatedAt };
  state.projects = [entry, ...state.projects.filter((x) => x.id !== p.id)];
  renderProjectList();
}

function showEmpty() {
  state.project = null;
  $("#projectView").classList.add("hidden");
  $("#emptyState").classList.remove("hidden");
  history.replaceState(null, "", location.pathname);
  renderProjectList();
}

function openNewDialog() {
  $("#newName").value = "";
  if (state.project) $("#newFormat").value = state.project.format;
  $("#newDialog").showModal();
  $("#newName").focus();
}

async function createProject() {
  const name = $("#newName").value.trim() || "Nieuwe post";
  try {
    const p = await api("POST", `${API_BASE}/projects`, { name, format: $("#newFormat").value }); // dashboard: API_BASE
    $("#newDialog").close();
    await loadProjects();
    await openProject(p.id);
    $('#briefForm [name="topic"]').focus();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------- project

async function openProject(id) {
  if (state.generating) return toast("Wacht tot de generatie klaar is.", true);
  await saveBrief.flush();
  await saveCaption.flush();
  try {
    state.project = await api("GET", `${API_BASE}/projects/${encodeURIComponent(id)}`); // dashboard: API_BASE
  } catch (err) {
    toast(err.message, true);
    return showEmpty();
  }
  history.replaceState(null, "", `#p=${encodeURIComponent(id)}`);
  $("#emptyState").classList.add("hidden");
  $("#projectView").classList.remove("hidden");
  fillProject();
  renderProjectList();
}

async function reloadProject() {
  if (!state.project) return;
  try {
    state.project = await api("GET", projectUrl());
    renderAssets();
    renderSlides();
    $("#caption").value = state.project.caption || "";
    syncListEntry();
  } catch (err) {
    toast(err.message, true);
  }
}

// Server-antwoorden op PUT/POST bevatten geen versionCount; behoud de oude waarde
function setProject(p) {
  const versionCount = p.versionCount ?? state.project?.versionCount ?? 0;
  state.project = { ...p, versionCount };
  syncListEntry();
}

function fillProject() {
  const p = state.project;
  $("#projectName").value = p.name;
  $("#projectFormat").value = p.format;
  const form = $("#briefForm");
  for (const key of ["topic", "text", "explanation", "audience", "cta", "slideCount"]) {
    form.elements[key].value = p.brief?.[key] ?? "";
  }
  form.elements.links.value = (p.links || []).join("\n");
  $("#brandChrome").checked = Boolean(p.brandChrome);
  $("#caption").value = p.caption || "";
  $("#postFeedback").value = "";
  $("#saveState").textContent = "";
  renderAssets();
  renderSlides();
}

function readBrief() {
  const form = $("#briefForm");
  const brief = {};
  for (const key of ["topic", "text", "explanation", "audience", "cta", "slideCount"]) {
    brief[key] = form.elements[key].value;
  }
  const links = form.elements.links.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { brief, links };
}

const saveBrief = debounce(async () => {
  if (!state.project) return;
  try {
    setProject(await api("PUT", projectUrl(), readBrief()));
    $("#saveState").textContent = "Opgeslagen";
  } catch (err) {
    $("#saveState").textContent = "";
    toast(err.message, true);
  }
}, 600);

const saveCaption = debounce(async () => {
  if (!state.project) return;
  try {
    setProject(await api("PUT", projectUrl(), { caption: $("#caption").value }));
  } catch (err) {
    toast(err.message, true);
  }
}, 600);

async function saveMeta(fields) {
  try {
    setProject(await api("PUT", projectUrl(), fields));
    if (fields.format || "brandChrome" in fields) renderSlides();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------- beeldmateriaal

function renderAssets() {
  const p = state.project;
  for (const kind of ["inspiratie", "beeld"]) {
    $(`#${kind}Thumbs`).innerHTML = (p.assets || [])
      .filter((a) => a.kind === kind)
      .map(
        (a) => `<div class="thumb" data-file="${escapeHtml(a.file)}">
          <img src="${FILES_BASE}/projects/${encodeURIComponent(p.id)}/assets/${encodeURIComponent(a.file)}" alt="" loading="lazy"><!-- dashboard: FILES_BASE -->
          <input value="${escapeHtml(a.note)}" placeholder="Notitie…">
          <button type="button" title="Verwijderen">×</button>
        </div>`
      )
      .join("");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Kon ${file.name} niet lezen`));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Afbeelding kon niet geladen worden"));
    img.src = src;
  });
}

function hasTransparency(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 255) return true;
  return false;
}

// Verklein tot max 2000px; PNG blijft PNG bij transparantie of als hij klein is
async function prepareImage(file) {
  const original = await readFileAsDataUrl(file);
  if (file.type === "image/gif") return original;
  const img = await loadImage(original);
  const max = 2000;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const isPng = file.type === "image/png";
  if (isPng && scale === 1 && file.size < 1.5 * 1024 * 1024) return original;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  if (isPng && hasTransparency(ctx, w, h)) return canvas.toDataURL("image/png");
  if (scale === 1 && file.type === "image/jpeg") return original;
  return canvas.toDataURL("image/jpeg", 0.88);
}

// dashboard: dataUrl uit prepareImage omzetten naar een blob voor de directe upload naar Storage
async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

// dashboard: uploaden in drie stappen (upload-URL vragen, bestand rechtstreeks naar
// Supabase Storage, daarna aan het project koppelen); zo blijft het buiten de
// 4,5 MB-limiet van Vercel. De respons van stap 3 is het project, zoals voorheen.
async function uploadFiles(files, kind) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  if (!images.length) return toast("Alleen afbeeldingen zijn toegestaan.", true);
  const projectId = state.project.id;
  toast(images.length > 1 ? `${images.length} afbeeldingen uploaden…` : "Afbeelding uploaden…");
  for (const file of images) {
    try {
      const dataUrl = await prepareImage(file);
      const blob = await dataUrlToBlob(dataUrl); // dashboard:
      if (blob.size > MAX_UPLOAD_BYTES) throw new Error("Afbeelding te groot (max 25 MB)"); // dashboard:
      const assetsUrl = `${API_BASE}/projects/${encodeURIComponent(projectId)}/assets`; // dashboard:
      const target = await api("POST", `${assetsUrl}/upload-url`, { name: file.name, contentType: blob.type }); // dashboard:
      const put = await fetch(target.signedUrl, { method: "PUT", headers: { "Content-Type": blob.type }, body: blob }); // dashboard:
      if (!put.ok) throw new Error(`Uploaden mislukt (${put.status})`); // dashboard:
      const p = await api("POST", assetsUrl, { // dashboard: koppelen in plaats van dataUrl posten
        file: target.file,
        name: file.name,
        kind,
        note: "",
      });
      if (state.project?.id === projectId) {
        setProject(p);
        renderAssets();
      }
    } catch (err) {
      toast(`${file.name}: ${err.message}`, true);
    }
  }
}

// ---------------------------------------------------------------- slides

function slideScale() {
  const f = fmt(state.project.format);
  return 460 / f.h;
}

function slideCardHtml(file, i, total) {
  const f = fmt(state.project.format);
  const s = slideScale();
  return `<div class="slide-card" data-file="${escapeHtml(file)}">
    <div class="slide-frame" style="width:${Math.round(f.w * s)}px;height:${Math.round(f.h * s)}px">
      <iframe src="${escapeHtml(slideSrc(file))}" sandbox="allow-same-origin" width="${f.w}" height="${f.h}" loading="lazy" tabindex="-1"
        style="width:${f.w}px;height:${f.h}px;transform:scale(${s})" title="Slide ${i + 1}"></iframe><!-- dashboard: sandbox zonder scripts -->
    </div>
    <div class="slide-meta">
      <span class="mono">${pad(i + 1)} / ${pad(total)}</span>
      <button data-act="left" title="Naar links" ${i === 0 ? "disabled" : ""}>←</button>
      <button data-act="right" title="Naar rechts" ${i === total - 1 ? "disabled" : ""}>→</button>
      <button data-act="revise" title="Aanpassen met Claude">Claude</button>
      <button data-act="duplicate" title="Dupliceren">Dupliceer</button>
      <button data-act="png" title="Download als PNG">PNG</button>
      <button data-act="delete" title="Verwijderen">×</button>
    </div>
  </div>`;
}

function renderSlides() {
  const p = state.project;
  const slides = p.slides || [];
  $("#slides").innerHTML = slides.map((file, i) => slideCardHtml(file, i, slides.length)).join("");
  $("#slidesEmpty").classList.toggle("hidden", slides.length > 0);
  $("#postTools").classList.toggle("hidden", slides.length === 0);
  $("#generateBtn").textContent = slides.length ? "Opnieuw genereren" : "Genereer post";
  $("#restoreBtn").classList.toggle("hidden", !(p.versionCount > 0));
  setBusy(state.generating);
}

function reloadSlideFrame(file) {
  const card = $$("#slides .slide-card").find((c) => c.dataset.file === file);
  const iframe = card && $("iframe", card);
  if (iframe) iframe.src = slideSrc(file);
}

function reloadAllFrames() {
  for (const iframe of $$("#slides iframe")) {
    const url = new URL(iframe.src, location.href);
    url.searchParams.set("v", Date.now());
    iframe.src = url.pathname + url.search;
  }
}

async function moveSlide(file, dir) {
  const slides = [...state.project.slides];
  const i = slides.indexOf(file);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= slides.length) return;
  [slides[i], slides[j]] = [slides[j], slides[i]];
  try {
    setProject(await api("PUT", projectUrl(), { slides }));
    renderSlides();
  } catch (err) {
    toast(err.message, true);
  }
}

async function duplicateSlide(file) {
  try {
    setProject(await api("POST", slideApi(file, "/duplicate")));
    renderSlides();
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteSlide(file) {
  const n = state.project.slides.indexOf(file) + 1;
  if (!confirm(`Slide ${n} verwijderen? Je kunt dit terugzetten via "Vorige versie".`)) return;
  try {
    await api("DELETE", slideApi(file));
    await reloadProject();
  } catch (err) {
    toast(err.message, true);
  }
}

async function downloadPng(file, btn) {
  const label = btn.textContent;
  btn.textContent = "Bezig…";
  btn.disabled = true;
  try {
    const res = await fetch(slideApi(file, "/png"));
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Fout ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    const name = m ? decodeURIComponent(m[1]) : `slide-${pad(state.project.slides.indexOf(file) + 1)}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}

function openRevise(file) {
  state.reviseFile = file;
  $("#reviseNum").textContent = state.project.slides.indexOf(file) + 1;
  // Na een mislukte poging staat de vorige feedback voor deze slide er nog
  $("#reviseText").value = state.reviseDraft?.file === file ? state.reviseDraft.feedback : "";
  $("#reviseDialog").showModal();
  $("#reviseText").focus();
}

// ---------------------------------------------------------------- generatie

function setBusy(busy) {
  const ids = ["generateBtn", "reviseAll", "reviseGo", "restoreBtn", "projectFormat", "duplicateProject", "deleteProject"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  }
  for (const btn of $$("#slides .slide-meta button")) {
    if (busy) btn.disabled = true;
    else {
      const act = btn.dataset.act;
      const card = btn.closest(".slide-card");
      const i = state.project?.slides.indexOf(card.dataset.file) ?? -1;
      const total = state.project?.slides.length ?? 0;
      btn.disabled = (act === "left" && i === 0) || (act === "right" && i === total - 1);
    }
  }
}

// Geeft true terug als de generatie is gelukt
async function streamGeneration(url, body) {
  if (state.generating) return false;
  let succeeded = false;
  const projectId = state.project.id;
  state.generating = true;
  state.abort = new AbortController();
  setBusy(true);

  const started = Date.now();
  let written = 0;
  const detail = () => {
    const secs = Math.round((Date.now() - started) / 1000);
    const parts = [];
    if (written) parts.push(`${written} ${written === 1 ? "slide" : "slides"} geschreven`);
    parts.push(`${secs} s`);
    $("#progressDetail").textContent = parts.join(" · ");
  };
  $("#progressTitle").textContent = "Claude gaat aan de slag…";
  detail();
  $("#progress").classList.remove("hidden");
  const timer = setInterval(detail, 1000);

  const handle = (ev) => {
    if (ev.type === "status") $("#progressTitle").textContent = ev.message;
    else if (ev.type === "progress") {
      written = ev.slides;
      detail();
    } else if (ev.type === "done") {
      if (state.project?.id === projectId) {
        setProject(ev.project);
        reloadProject();
      }
      succeeded = true;
      toast("Klaar! De slides zijn bijgewerkt.");
      return true;
    } else if (ev.type === "error") {
      toast(ev.message || "Er ging iets mis.", true);
      return true;
    }
    return false;
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: state.abort.signal,
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.includes("text/event-stream")) {
      const data = type.includes("application/json") ? await res.json().catch(() => ({})) : {};
      throw new Error(data.error || `Fout ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            if (handle(JSON.parse(line.slice(6)))) finished = true;
          } catch {
            // onvolledige of ongeldige regel overslaan
          }
        }
      }
    }
    if (!finished) toast("De verbinding werd onverwacht verbroken.", true);
  } catch (err) {
    if (err.name === "AbortError") {
      toast("Generatie gestopt.");
      if (state.project?.id === projectId) reloadProject();
    } else toast(err.message, true);
  } finally {
    clearInterval(timer);
    $("#progress").classList.add("hidden");
    state.generating = false;
    state.abort = null;
    setBusy(false);
  }
  return succeeded;
}

async function generate() {
  if (!state.project || state.generating) return;
  if (state.project.slides.length && !confirm("De huidige slides worden vervangen. De vorige versie blijft terug te zetten. Doorgaan?")) return;
  await saveBrief.flush();
  await streamGeneration(projectUrl("/generate"), {});
}

async function reviseAll() {
  const feedback = $("#postFeedback").value.trim();
  if (!feedback) return toast("Schrijf eerst wat er anders moet.", true);
  // Feedback pas wissen als het gelukt is, zodat je hem bij een fout niet opnieuw hoeft te typen
  if (await streamGeneration(projectUrl("/generate"), { feedback })) $("#postFeedback").value = "";
}

async function reviseSlide() {
  const feedback = $("#reviseText").value.trim();
  if (!feedback) return toast("Schrijf eerst wat er anders moet.", true);
  const file = state.reviseFile;
  $("#reviseDialog").close();
  const ok = await streamGeneration(slideApi(file, "/revise"), { feedback });
  state.reviseDraft = ok ? null : { file, feedback };
}

async function restoreVersion() {
  if (!confirm("De vorige versie terugzetten? De huidige slides worden vervangen.")) return;
  try {
    await api("POST", projectUrl("/restore"));
    await reloadProject();
    toast("Vorige versie teruggezet.");
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------- editor

const BASE_RE = /<base data-studio[^>]*>/gi;

function withBase(html) {
  const base = `<base data-studio href="${FILES_BASE}/projects/${encodeURIComponent(state.project.id)}/slides/">`; // dashboard: FILES_BASE
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + base);
  return base + html;
}

function serializePreview() {
  const doc = $("#editorPreview").contentDocument;
  if (!doc?.documentElement) return $("#code").value;
  const html = "<!doctype html>\n" + doc.documentElement.outerHTML;
  // outerHTML plakt <html><head> en </body></html> aan elkaar; houd de opmaak leesbaar
  return html
    .replace(BASE_RE, "")
    .replace(/(<html[^>]*>)\s*<head>/i, "$1\n<head>")
    .replace(/\s*<\/body>\s*<\/html>\s*$/i, "\n</body>\n</html>\n");
}

function currentEditorHtml() {
  return state.editor.mode === "visual" ? serializePreview() : $("#code").value;
}

function loadPreview(html, editable) {
  const iframe = $("#editorPreview");
  iframe.onload = () => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    if (editable) {
      doc.designMode = "on";
      doc.addEventListener("input", () => (state.editor.dirty = true));
      doc.addEventListener("keydown", editorKeys);
    }
  };
  iframe.srcdoc = withBase(html);
}

function fitPreview() {
  if (!state.editor) return;
  const wrap = $("#editorPreviewWrap");
  const iframe = $("#editorPreview");
  const f = fmt(state.project.format);
  const pad = 24;
  const W = wrap.clientWidth - pad * 2;
  const H = wrap.clientHeight - pad * 2;
  if (W <= 0 || H <= 0) return;
  const s = Math.min(W / f.w, H / f.h);
  iframe.style.width = `${f.w}px`;
  iframe.style.height = `${f.h}px`;
  iframe.style.transform = `scale(${s})`;
  iframe.style.left = `${Math.round((wrap.clientWidth - f.w * s) / 2)}px`;
  iframe.style.top = `${Math.round((wrap.clientHeight - f.h * s) / 2)}px`;
}

async function openEditor(file) {
  const index = state.project.slides.indexOf(file);
  let html;
  try {
    html = await api("GET", slideApi(file));
  } catch (err) {
    return toast(err.message, true);
  }
  state.editor = { file, index, mode: "visual", original: html, dirty: false };
  $("#editorTitle").textContent = `Slide ${index + 1} / ${state.project.slides.length}`;
  $("#code").value = html;
  setEditorMode("visual", true);
  $("#editor").showModal();
  requestAnimationFrame(fitPreview);
}

function setEditorMode(mode, initial = false) {
  const ed = state.editor;
  if (!ed) return;
  if (!initial && mode === ed.mode) return;
  if (!initial && ed.mode === "visual") $("#code").value = serializePreview();
  ed.mode = mode;
  for (const tab of $$("#editor .tab")) tab.classList.toggle("active", tab.dataset.mode === mode);
  const visual = mode === "visual";
  $("#code").classList.toggle("hidden", visual);
  $("#editor .editor-body").classList.toggle("split", !visual);
  $("#editorHint").textContent = visual
    ? "Klik in de slide om tekst direct aan te passen."
    : "Pas de HTML aan; het voorbeeld werkt live bij. Cmd/Ctrl+S slaat op.";
  loadPreview($("#code").value, visual);
  requestAnimationFrame(fitPreview);
}

const updateCodePreview = debounce(() => {
  if (state.editor?.mode === "code") loadPreview($("#code").value, false);
}, 300);

async function saveEditor() {
  const ed = state.editor;
  if (!ed) return;
  const html = currentEditorHtml();
  try {
    setProject(await api("PUT", slideApi(ed.file), { html }));
    state.project.versionCount = (state.project.versionCount || 0) + 1;
    closeEditor();
    renderSlides();
    toast("Slide opgeslagen.");
  } catch (err) {
    toast(err.message, true);
  }
}

function closeEditor() {
  state.editor = null;
  $("#editorPreview").srcdoc = "";
  $("#editor").close();
}

function cancelEditor() {
  const ed = state.editor;
  if (!ed) return $("#editor").close();
  const changed = ed.dirty || (ed.mode === "code" && $("#code").value !== ed.original);
  if (changed && !confirm("Wijzigingen weggooien?")) return;
  closeEditor();
}

function editorKeys(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveEditor();
  }
}

// ---------------------------------------------------------------- menu's, export, project-acties

function closeMenus(except) {
  for (const m of $$(".menu-pop")) if (m !== except) m.classList.add("hidden");
}

function toggleMenu(menu) {
  const open = menu.classList.contains("hidden");
  closeMenus();
  menu.classList.toggle("hidden", !open);
}

function exportAs(ext) {
  closeMenus();
  if (!state.project?.slides.length) return toast("Er zijn nog geen slides om te exporteren.", true);
  toast("Exporteren… dit kan even duren");
  download(projectUrl(`/export.${ext}`));
}

// dashboard: online is er geen Finder; download in plaats daarvan een ZIP met de HTML-bestanden
// dashboard: eerst openstaande wijzigingen opslaan, dan de ZIP laten klaarzetten. Bij een
// fout blijft de pagina staan en verschijnt een toast (zoals bij de oude /reveal-call).
async function openFolder() {
  closeMenus();
  await saveBrief.flush();
  await saveCaption.flush();
  toast("ZIP klaarzetten…");
  const ctrl = new AbortController();
  try {
    const res = await fetch(projectUrl("/source.zip"), { signal: ctrl.signal });
    const type = res.headers.get("content-type") || "";
    if (!res.ok) {
      const data = type.includes("application/json") ? await res.json().catch(() => null) : null;
      throw new Error((data && data.error) || `Fout ${res.status}`);
    }
    if (res.redirected && new URL(res.url).origin !== location.origin) {
      // De server stuurt door naar een signed URL; die downloadt onder de juiste naam.
      ctrl.abort(); // de inhoud niet twee keer ophalen
      download(res.url);
    } else if (type.includes("application/zip")) {
      const href = URL.createObjectURL(await res.blob());
      download(href);
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } else {
      throw new Error("Je sessie is verlopen. Log opnieuw in.");
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function duplicateProject() {
  closeMenus();
  if (state.generating) return toast("Wacht tot de generatie klaar is.", true);
  try {
    const p = await api("POST", projectUrl("/duplicate"));
    await loadProjects();
    await openProject(p.id);
    toast("Project gedupliceerd.");
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteProject() {
  closeMenus();
  if (state.generating) return toast("Wacht tot de generatie klaar is.", true);
  if (!confirm("Project verplaatsen naar de prullenbak?")) return;
  try {
    await api("DELETE", projectUrl());
    state.project = null;
    await loadProjects();
    if (state.projects.length) await openProject(state.projects[0].id);
    else showEmpty();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------- huisstijl & instellingen

async function openBrand() {
  try {
    const brand = await api("GET", `${API_BASE}/brand`); // dashboard: API_BASE
    $("#brandGuide").value = brand.guide || "";
    $("#brandCss").value = brand.css || "";
    $("#brandDialog").showModal();
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveBrand() {
  try {
    await api("PUT", `${API_BASE}/brand`, { guide: $("#brandGuide").value, css: $("#brandCss").value }); // dashboard: API_BASE
    $("#brandDialog").close();
    reloadAllFrames();
    toast("Huisstijl opgeslagen.");
  } catch (err) {
    toast(err.message, true);
  }
}

// dashboard: de key wordt niet meer vanuit de app opgeslagen (Vercel env var ANTHROPIC_API_KEY);
// de dialoog toont alleen de status, dus er is geen saveKey meer.

// ---------------------------------------------------------------- events

function bindEvents() {
  // sidebar
  $("#newProject").addEventListener("click", openNewDialog);
  $("#newProject2")?.addEventListener("click", openNewDialog);
  $("#search").addEventListener("input", renderProjectList);
  $("#projectList").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-id]");
    if (a && a.dataset.id !== state.project?.id) openProject(a.dataset.id);
  });
  $("#openBrand").addEventListener("click", openBrand);
  $("#openSettings").addEventListener("click", () => $("#settingsDialog").showModal());
  window.addEventListener("hashchange", () => {
    const id = hashId();
    if (id && id !== state.project?.id) openProject(id);
  });

  // dialogs
  for (const btn of $$("[data-close]")) btn.addEventListener("click", () => btn.closest("dialog").close());
  $("#newGo").addEventListener("click", createProject);
  $("#newName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      createProject();
    }
  });
  $("#reviseGo").addEventListener("click", reviseSlide);
  $("#reviseText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) reviseSlide();
  });
  $("#brandSave").addEventListener("click", saveBrand);
  // dashboard: geen key-invoer meer in de instellingen-dialoog

  // projectkop
  $("#projectName").addEventListener("change", () => {
    const name = $("#projectName").value.trim();
    if (!name) return ($("#projectName").value = state.project.name);
    saveMeta({ name });
  });
  $("#projectName").addEventListener("keydown", (e) => e.key === "Enter" && e.target.blur());
  $("#projectFormat").addEventListener("change", () => saveMeta({ format: $("#projectFormat").value }));
  $("#restoreBtn").addEventListener("click", restoreVersion);
  $("#brandChrome").addEventListener("change", (e) => saveMeta({ brandChrome: e.target.checked }));

  // briefing
  const form = $("#briefForm");
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("input", (e) => {
    if (e.target.closest(".thumb") || e.target.type === "file" || e.target.id === "brandChrome") return;
    $("#saveState").textContent = "Opslaan…";
    saveBrief();
  });
  $("#caption").addEventListener("input", saveCaption);
  $("#copyCaption").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#caption").value);
      toast("Posttekst gekopieerd.");
    } catch {
      toast("Kopiëren lukte niet.", true);
    }
  });

  // drop-zones
  for (const drop of $$(".drop")) {
    const input = $('input[type="file"]', drop);
    const kind = drop.dataset.kind;
    drop.addEventListener("click", (e) => {
      if (e.target.closest(".thumb")) return;
      input.click();
    });
    input.addEventListener("change", () => {
      if (input.files.length) uploadFiles(input.files, kind);
      input.value = "";
    });
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", (e) => {
      if (!drop.contains(e.relatedTarget)) drop.classList.remove("over");
    });
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files, kind);
    });
    // thumbnails: notitie en verwijderen
    drop.addEventListener("change", async (e) => {
      const thumb = e.target.closest(".thumb");
      if (!thumb || e.target.tagName !== "INPUT") return;
      try {
        setProject(
          await api("PUT", projectUrl(`/assets/${encodeURIComponent(thumb.dataset.file)}`), { note: e.target.value })
        );
      } catch (err) {
        toast(err.message, true);
      }
    });
    drop.addEventListener("click", async (e) => {
      const btn = e.target.closest(".thumb button");
      if (!btn) return;
      e.stopPropagation();
      const file = btn.closest(".thumb").dataset.file;
      try {
        setProject(await api("DELETE", projectUrl(`/assets/${encodeURIComponent(file)}`)));
        renderAssets();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // generatie
  $("#generateBtn").addEventListener("click", generate);
  $("#reviseAll").addEventListener("click", reviseAll);
  $("#cancelGen").addEventListener("click", () => state.abort?.abort());

  // slides
  $("#slides").addEventListener("click", (e) => {
    const card = e.target.closest(".slide-card");
    if (!card) return;
    const file = card.dataset.file;
    if (e.target.closest(".slide-frame")) {
      if (!state.generating) openEditor(file);
      return;
    }
    const btn = e.target.closest("button[data-act]");
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === "left") moveSlide(file, -1);
    else if (act === "right") moveSlide(file, 1);
    else if (act === "revise") openRevise(file);
    else if (act === "duplicate") duplicateSlide(file);
    else if (act === "png") downloadPng(file, btn);
    else if (act === "delete") deleteSlide(file);
  });

  // editor
  for (const tab of $$("#editor .tab")) tab.addEventListener("click", () => setEditorMode(tab.dataset.mode));
  $("#editorSave").addEventListener("click", saveEditor);
  $("#editorCancel").addEventListener("click", cancelEditor);
  $("#editor").addEventListener("cancel", (e) => {
    e.preventDefault();
    cancelEditor();
  });
  $("#editor").addEventListener("keydown", editorKeys);
  const code = $("#code");
  code.addEventListener("input", () => {
    if (state.editor) state.editor.dirty = true;
    updateCodePreview();
  });
  code.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end, value } = code;
    code.value = value.slice(0, start) + "  " + value.slice(end);
    code.selectionStart = code.selectionEnd = start + 2;
    updateCodePreview();
  });
  window.addEventListener("resize", fitPreview);
  new ResizeObserver(fitPreview).observe($("#editorPreviewWrap"));

  // menu's en export
  $("#exportBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu($("#exportMenu"));
  });
  $("#moreBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu($("#moreMenu"));
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu")) closeMenus();
  });
  $("#exportZip").addEventListener("click", () => exportAs("zip"));
  $("#exportPdf").addEventListener("click", () => exportAs("pdf"));
  $("#openFolder").addEventListener("click", openFolder);
  $("#duplicateProject").addEventListener("click", duplicateProject);
  $("#deleteProject").addEventListener("click", deleteProject);
}

init();
