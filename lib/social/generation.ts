// Port van runGeneration() uit Social-media-tool/server.js:306-384 voor een
// Next.js route handler met een SSE-stream (ReadableStream).
// - Validatiefouten gaan als JSON `{ error }` terug, vóór de stream start.
// - De `data:`-events zijn identiek: status / progress / done / error.
// - request.signal (browser verbreekt/stopt) breekt de Anthropic-stream af.
// - Pas na het "done"-moment wordt er opgeslagen, exact zoals de bron.

import { buildMessages, countSlides, generate, hasApiKey, parseOutput, type Mode } from "./claude";
import { enforceBrand, setCanvas } from "./brand-guard";
import { getFormat } from "./formats";
import { HttpError, readBody } from "./http";
import { id } from "./ids";
import { checkSlide, getBrand, getProject, readSlides, refreshChrome, saveProject, snapshot } from "./repo";

const TIME_LIMIT_MS = 285_000;
const TIMEOUT_MESSAGE =
  "De generatie duurde te lang voor de server (max 5 min). Probeer het opnieuw of met minder beelden.";

type ErrorLike = { status?: number; message?: string };

/** Letterlijk uit server.js:379-384. */
export function friendlyError(err: unknown) {
  const e = (err ?? {}) as ErrorLike;
  if (e.status === 401) return "De API-key wordt niet geaccepteerd. Controleer hem bij Instellingen.";
  if (e.status === 429) return "Even te veel aanvragen tegelijk. Wacht een minuut en probeer opnieuw.";
  if (e.status === 529 || (e.status ?? 0) >= 500) return "De Claude API is even overbelast. Probeer het zo opnieuw.";
  return e.message || "Er ging iets mis.";
}

export async function runGeneration(
  request: Request,
  { projectId, mode: modeArg, targetFile }: { projectId: string; mode?: Mode; targetFile?: string },
): Promise<Response> {
  const started = Date.now();
  const body = await readBody(request);
  // server.js:386: met feedback is het "revise-all", anders "new".
  const mode: Mode = modeArg ?? (body.feedback ? "revise-all" : "new");

  const p = await getProject(projectId);
  if (!hasApiKey()) throw new HttpError(400, "Er is nog geen API-key ingesteld (zie Instellingen).");
  const feedback = String(body.feedback || "").trim();
  if (mode !== "new" && !feedback) throw new HttpError(400, "Schrijf eerst wat er anders moet.");

  const slides = await readSlides(p);
  const targetIndex = targetFile ? p.slides.indexOf(targetFile) : -1;
  if (targetFile) checkSlide(p, targetFile);
  const brand = await getBrand();

  const encoder = new TextEncoder();
  const abort = new AbortController();
  let timedOut = false;
  const onClientAbort = () => abort.abort();
  request.signal.addEventListener("abort", onClientAbort);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };
      const timer = setTimeout(
        () => {
          timedOut = true;
          abort.abort();
        },
        Math.max(1_000, TIME_LIMIT_MS - (Date.now() - started)),
      );

      let text = "";
      let seen = 0;
      try {
        send({ type: "status", message: "Claude denkt na over het ontwerp…" });
        text = await generate({
          brand,
          messages: await buildMessages({ project: p, mode, feedback, slides, targetIndex }),
          signal: abort.signal,
          onText: (delta) => {
            if (!text) send({ type: "status", message: "Slides worden geschreven…" });
            text += delta;
            const n = countSlides(text);
            if (n !== seen) {
              seen = n;
              send({ type: "progress", slides: n });
            }
          },
        });
        clearTimeout(timer);

        const out = parseOutput(text);
        if (!out.slides.length) throw new Error("Er kwamen geen slides terug. Probeer het opnieuw.");
        const fmt = getFormat(p.format);
        const fresh = await getProject(p.id);
        await snapshot(fresh, mode);

        const fixes = new Set<string>();
        const prepare = (html: string) => {
          const res = enforceBrand(html);
          res.fixes.forEach((f) => fixes.add(f));
          return setCanvas(res.html, fmt, fresh.format);
        };
        const pending = new Map<string, string>();
        if (mode === "revise-one" && targetFile) {
          pending.set(targetFile, prepare(out.slides[0]));
        } else {
          fresh.slides = out.slides.map((html) => {
            const file = `slide-${id()}.html`;
            pending.set(file, prepare(html));
            return file;
          });
          if (out.caption !== null) fresh.caption = out.caption;
        }
        await refreshChrome(fresh, pending);
        if (fixes.size) console.log(`  Huisstijl gecorrigeerd (${fresh.id}): ${[...fixes].join(", ")}`);
        if (mode === "revise-all" || mode === "revise-one") {
          fresh.feedbackLog = [...(fresh.feedbackLog || []), { at: new Date().toISOString(), mode, feedback }];
        }
        send({ type: "done", project: await saveProject(fresh) });
      } catch (err) {
        if (timedOut) send({ type: "error", message: TIMEOUT_MESSAGE });
        else if (!abort.signal.aborted) send({ type: "error", message: friendlyError(err) });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onClientAbort);
        open = false;
        try {
          controller.close();
        } catch {
          // stream was al gesloten (browser weg)
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
