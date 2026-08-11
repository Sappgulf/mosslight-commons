/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional override for the Torx+THRML sidecar endpoint. */
  readonly VITE_TORX_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
