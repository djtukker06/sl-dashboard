import { createHmac } from 'node:crypto';

// De OAuth-state van de Meta-koppeling: dezelfde ondertekende cookie als bij Drive en Google
// Agenda (lib/drive/state.ts: maakState/controleerState), met een eigen cookie en een eigen
// afgeleid geheim, zodat een Drive- of agenda-state nooit als Meta-state geldt en andersom.

export const STATE_COOKIE = 'sl_meta_state';
export const CALLBACK_PAD = '/api/social/meta/callback';

export function stateGeheim(sleutel: Buffer): Buffer {
  return createHmac('sha256', sleutel).update('studio-levant/meta-oauth-state/v1').digest();
}
