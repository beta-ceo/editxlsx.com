/**
 * Segment timing for the /workspace "Opening workbook…" path.
 *
 * Editor marks absolute `performance.now()` points; the shell merges its own
 * overlay span and prints one table. Kept behind a plain object on
 * `window.__openTiming` so Playwright / DevTools can read the last report
 * without scraping console text.
 */

export type OpenTimingMark = string;

export type OpenTimingSegment = {
  name: string;
  ms: number;
};

export type OpenTimingReport = {
  workbookId: string;
  /** performance.now() at session start (editor frame). */
  t0: number;
  /** Absolute performance.now() for each mark. */
  marks: Record<string, number>;
  /** Ordered deltas between consecutive marks (and named spans). */
  segments: OpenTimingSegment[];
  /** editor start → shell:workbook-ready posted. */
  totalMs: number;
  /** Shell-side overlay span when the parent filled it in. */
  overlayMs?: number;
  iframeLoadMs?: number;
  bundleBootMs?: number;
};

type OpenTimingHost = Window & {
  __openTiming?: OpenTimingReport | null;
  __openTimingLog?: OpenTimingReport[];
};

const SEGMENT_PAIRS: Array<[from: string, to: string, name: string]> = [
  ['start', 'imports', 'dynamic imports'],
  ['imports', 'auth', 'getCurrentUser'],
  ['auth', 'meta', 'getWorkbook'],
  ['meta', 'pending', 'IndexedDB pending'],
  ['pending', 'download', 'Storage download'],
  ['imports', 'payload', 'wait shell payload'],
  ['synced', 'api', 'loadEditorApi'],
  ['download', 'api', 'loadEditorApi'],
  ['api', 'mounted', 'openLocalFile (buffer+DocEditor)'],
  ['mounted', 'ready', 'postShellReady'],
];

export class OpenTiming {
  readonly workbookId: string;
  readonly t0: number;
  private readonly marks = new Map<string, number>();

  constructor(workbookId: string) {
    this.workbookId = workbookId;
    this.t0 = performance.now();
    this.marks.set('start', this.t0);
  }

  mark(name: OpenTimingMark): void {
    if (!this.marks.has(name)) this.marks.set(name, performance.now());
  }

  buildReport(extra: Partial<OpenTimingReport> = {}): OpenTimingReport {
    const marks: Record<string, number> = {};
    for (const [key, value] of this.marks) marks[key] = value;
    const ready = marks.ready ?? performance.now();
    const segments: OpenTimingSegment[] = [];
    for (const [from, to, name] of SEGMENT_PAIRS) {
      const a = marks[from];
      const b = marks[to];
      if (typeof a === 'number' && typeof b === 'number') {
        segments.push({ name, ms: Math.round(b - a) });
      }
    }
    return {
      workbookId: this.workbookId,
      t0: this.t0,
      marks,
      segments,
      totalMs: Math.round(ready - this.t0),
      ...extra,
    };
  }
}

export function publishOpenTiming(report: OpenTimingReport): void {
  if (typeof window === 'undefined') return;
  const host = window as OpenTimingHost;
  host.__openTiming = report;
  const log = host.__openTimingLog ?? [];
  log.push(report);
  host.__openTimingLog = log;
  // One structured line for Playwright console listeners / DevTools copy.
  console.info('[open-timing]', JSON.stringify(report));
  if (typeof console.table === 'function' && report.segments.length > 0) {
    console.table(report.segments);
  }
  console.info(
    `[open-timing] workbook=${report.workbookId} total=${report.totalMs}ms` +
      (typeof report.overlayMs === 'number' ? ` overlay=${report.overlayMs}ms` : ''),
  );
}

export function mergeShellOverlayTiming(
  report: OpenTimingReport,
  shell: { overlayMs: number; iframeLoadMs?: number; bundleBootMs?: number },
): OpenTimingReport {
  return {
    ...report,
    overlayMs: shell.overlayMs,
    iframeLoadMs: shell.iframeLoadMs,
    bundleBootMs: shell.bundleBootMs,
    segments: [
      ...(typeof shell.iframeLoadMs === 'number'
        ? [{ name: 'shell: iframe load', ms: shell.iframeLoadMs }]
        : []),
      ...(typeof shell.bundleBootMs === 'number'
        ? [{ name: 'shell: bundle boot (after load)', ms: shell.bundleBootMs }]
        : []),
      { name: 'shell: overlay total', ms: shell.overlayMs },
      ...report.segments,
    ],
  };
}
