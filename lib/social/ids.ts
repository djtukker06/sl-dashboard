import crypto from "node:crypto";

// Zelfde regels als Social-media-tool/server.js:39-40.

/** Willekeurige 8-teken hex-id (server.js `id()`). */
export const id = () => crypto.randomBytes(4).toString("hex");

/** Alleen veilige namen voor project-id's en bestandsnamen (server.js `safe()`). */
export const safe = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(s);

/** Nieuw project-id: `YYYY-MM-DD-<8hex>` (server.js:144). */
export const newProjectId = (now: string = new Date().toISOString()) => `${now.slice(0, 10)}-${id()}`;

/** Bestandsnaamvriendelijke versie van een projectnaam (server.js:396). */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "post";
