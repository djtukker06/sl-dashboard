// Minimale typen voor libheif-js (LGPL-3.0, Emscripten-build van libheif), alleen wat
// lib/uitgaven/beeld.ts (server) en lib/uitgaven/heic.ts (browser) gebruiken.

declare namespace LibHeif {
  interface Pixels {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    /** Decodeert naar RGBA (met rotatie/spiegeling uit het bestand toegepast) en roept cb aan; null bij een fout. */
    display(doel: Pixels, cb: (resultaat: Pixels | null) => void): void;
    free(): void;
  }
  interface HeifDecoder {
    decode(inhoud: Uint8Array): HeifImage[];
  }
  interface Module {
    HeifDecoder: new () => HeifDecoder;
  }
}

/** Node: wasm zit in de .js (base64); het module-object is direct bruikbaar. */
declare module 'libheif-js/wasm-bundle.js' {
  const libheif: LibHeif.Module;
  export = libheif;
}

/** Browser (ESM): fabriek die het module-object geeft. */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const fabriek: (opties?: Record<string, unknown>) => LibHeif.Module | Promise<LibHeif.Module>;
  export default fabriek;
}
