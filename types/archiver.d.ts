// Minimale typen voor archiver v8 (ESM, named export `ZipArchive`). @types/archiver
// beschrijft de oude v5/v6-API met een default-export en past dus niet.
declare module "archiver" {
  import type { Transform } from "node:stream";

  export interface EntryData {
    name: string;
    date?: Date | string;
    mode?: number;
    prefix?: string;
  }

  export class Archiver extends Transform {
    constructor(options?: Record<string, unknown>);
    append(source: Buffer | string | NodeJS.ReadableStream, data: EntryData): this;
    finalize(): Promise<void>;
    abort(): this;
    pointer(): number;
  }

  export class ZipArchive extends Archiver {
    constructor(options?: { zlib?: { level?: number }; comment?: string; forceLocalTime?: boolean });
  }
}
