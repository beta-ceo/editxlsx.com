/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Cloudflare Web Analytics beacon token. When unset, analytics is disabled
   * and no external request is made — keeps forks and local dev tracking-free.
   * The token is a public client-side value, so exposing it in the build is safe.
   */
  readonly VITE_CF_BEACON_TOKEN?: string;
  /**
   * Appwrite API endpoint (e.g. https://sfo.cloud.appwrite.io/v1).
   * Falls back to the editxlsx Cloud endpoint when unset.
   */
  readonly VITE_APPWRITE_ENDPOINT?: string;
  /**
   * Appwrite project ID. Falls back to the editxlsx project when unset.
   */
  readonly VITE_APPWRITE_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
