import { describe, expect, it } from 'vitest';
import { mergeShellOverlayTiming, OpenTiming } from '../../lib/open-timing';

describe('open timing', () => {
  it('builds ordered segments between marked points', () => {
    const timing = new OpenTiming('wb1');
    timing.mark('imports');
    timing.mark('auth');
    timing.mark('meta');
    timing.mark('pending');
    timing.mark('download');
    timing.mark('api');
    timing.mark('mounted');
    timing.mark('ready');
    const report = timing.buildReport();
    expect(report.workbookId).toBe('wb1');
    expect(report.segments.map((s) => s.name)).toEqual([
      'dynamic imports',
      'getCurrentUser',
      'getWorkbook',
      'IndexedDB pending',
      'Storage download',
      'loadEditorApi',
      'openLocalFile (buffer+DocEditor)',
      'postShellReady',
    ]);
    expect(report.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('reports the shell-payload wait path when meta marks are skipped', () => {
    const timing = new OpenTiming('wb1');
    timing.mark('imports');
    timing.mark('payload');
    timing.mark('synced');
    timing.mark('api');
    timing.mark('mounted');
    timing.mark('ready');
    expect(timing.buildReport().segments.map((s) => s.name)).toEqual([
      'dynamic imports',
      'wait shell payload',
      'loadEditorApi',
      'openLocalFile (buffer+DocEditor)',
      'postShellReady',
    ]);
  });

  it('merges shell overlay spans ahead of editor segments', () => {
    const timing = new OpenTiming('wb1');
    timing.mark('ready');
    const merged = mergeShellOverlayTiming(timing.buildReport(), {
      overlayMs: 1200,
      iframeLoadMs: 200,
      bundleBootMs: 150,
    });
    expect(merged.overlayMs).toBe(1200);
    expect(merged.segments[0]).toEqual({ name: 'shell: iframe load', ms: 200 });
    expect(merged.segments[1]).toEqual({ name: 'shell: bundle boot (after load)', ms: 150 });
    expect(merged.segments[2]).toEqual({ name: 'shell: overlay total', ms: 1200 });
  });
});
