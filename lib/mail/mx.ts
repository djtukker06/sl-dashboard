import 'server-only';
import { resolveMx } from 'node:dns/promises';
import type { MxZoeker } from './providers';

/** MX-records van een domein, met een time-out van 3 s; bij een fout een lege lijst. */
export const zoekMx: MxZoeker = async (domein) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolveMx(domein),
      new Promise<never>((_, weiger) => {
        timer = setTimeout(() => weiger(new Error('time-out')), 3000);
      })
    ]);
    return records.map((r) => r.exchange);
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
};
