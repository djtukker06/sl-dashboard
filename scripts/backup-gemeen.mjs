// Gedeelde stukken voor scripts/backup-controleren.mjs en scripts/backup-herstellen.mjs.
// Sleutels komen UITSLUITEND uit de procesomgeving (node --env-file=.env.local …); dit
// bestand leest zelf geen .env-bestanden en print nooit een sleutel, token of rij-inhoud.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const laad = (...p) => import(pathToFileURL(path.join(ROOT, ...p)).href);

/**
 * Laadt de TypeScript-kernen (type-stripping, Node >= 22.6). Lukt dat niet zonder vlag, dan
 * start het aanroepende script zichzelf opnieuw met --experimental-strip-types.
 */
export async function laadKernen(scriptUrl) {
  try {
    return {
      formaat: await laad("lib", "backup", "formaat-kern.ts"),
      herstel: await laad("lib", "backup", "herstel-kern.ts"),
    };
  } catch (e) {
    if (process.execArgv.includes("--experimental-strip-types")) throw e;
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", ...process.execArgv, fileURLToPath(scriptUrl), ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
    });
    process.exit(r.status ?? 1);
  }
}

export async function laadDriveKernen() {
  return {
    kern: await laad("lib", "drive", "kern.ts"),
    kluis: await laad("lib", "mail", "kluis-kern.ts"),
  };
}

/** De back-upsleutel uit BACKUP_ENCRYPTION_KEY (of stopt met een duidelijke melding). */
export function backupSleutel(formaat, fout) {
  const k = formaat.leesBackupSleutel(process.env.BACKUP_ENCRYPTION_KEY);
  if (!k) {
    fout(
      "BACKUP_ENCRYPTION_KEY ontbreekt of is ongeldig (32 bytes, base64).\n" +
        "       Haal hem uit je wachtwoordmanager en start zo:\n" +
        "       node --env-file=.env.local scripts/<script>.mjs …",
    );
  }
  return k;
}

/**
 * Een Drive-client via de koppeling in de database (drive_koppeling, met de service-role),
 * net als de server. Nodig: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en de sleutel van het
 * refresh token (DRIVE_ENCRYPTION_KEY, anders MAIL_ENCRYPTION_KEY).
 */
export async function driveClient(sb, fout) {
  const { kern, kluis } = await laadDriveKernen();
  const { data, error } = await sb.from("drive_koppeling").select("refresh_token_enc, root_id").eq("id", 1).maybeSingle();
  if (error) fout(`Drive-koppeling lezen mislukt (${error.code ?? "fout"})`);
  if (!data) fout("Google Drive is niet gekoppeld (Bestanden › Drive koppelen).");
  const eigen = (process.env.DRIVE_ENCRYPTION_KEY ?? "").trim();
  const sleutel = kluis.leesSleutel(eigen || process.env.MAIL_ENCRYPTION_KEY);
  if (!sleutel) fout("DRIVE_ENCRYPTION_KEY of MAIL_ENCRYPTION_KEY ontbreekt in de omgeving.");
  let refresh;
  try {
    refresh = kluis.ontsleutelMet(sleutel, data.refresh_token_enc, "drive-koppeling");
  } catch {
    fout("Het Drive-token is niet te ontsleutelen (andere sleutel?). Koppel Drive opnieuw.");
  }
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) fout("GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET ontbreken in de omgeving.");
  let token = null;
  const client = new kern.DriveClient(fetch, async (vers) => {
    if (!token || vers) token = (await kern.vernieuwToken(fetch, { clientId, clientSecret, refreshToken: refresh })).accessToken;
    return token;
  });
  return { client, rootId: data.root_id };
}

export function grootteTekst(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
