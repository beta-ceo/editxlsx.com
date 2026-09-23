/**
 * Shared E2E artifact paths. Repo root stays one tree per concern; parallel
 * sessions still isolate by `E2E_PORT` because Playwright clears `outputDir`
 * and vite rewrites `--outDir` mid-serve.
 *
 *   test-results/e2e-<port>/   failure artifacts + suite reports
 *   dist-e2e/<port>/           isolated preview builds (default stays `dist/`)
 */

export function e2eResultsDir(): string {
  return `test-results/e2e-${process.env.E2E_PORT || '4173'}`;
}

/** Vite outDir for the E2E preview. Unset E2E_PORT keeps the deploy `dist/`. */
export function e2eDistDir(): string {
  if (!process.env.E2E_PORT) return 'dist';
  return `dist-e2e/${process.env.E2E_PORT}`;
}
