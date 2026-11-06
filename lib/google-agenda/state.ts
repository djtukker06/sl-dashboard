import { createHmac } from 'node:crypto';

// De OAuth-state van de Google Agenda-koppeling: dezelfde ondertekende cookie als bij Drive
// (lib/drive/state.ts), maar met een eigen cookie en een eigen afgeleid geheim, zodat een
// Drive-state nooit als agenda-state geldt en andersom.

export const STATE_COOKIE = 'sl_gagenda_state';

export function stateGeheim(sleutel: Buffer): Buffer {
  return createHmac('sha256', sleutel).update('studio-levant/google-agenda-oauth-state/v1').digest();
}
