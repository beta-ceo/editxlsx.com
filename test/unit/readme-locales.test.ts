import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The English readme is the project's front page. Multilingual readme files
 * were retired when the site moved to seven in-app locales; this pins the
 * facts that must not drift: live URL, MIT license link, Docker image tag.
 */
const ROOT = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');

describe('readme', () => {
  it('exists', () => {
    expect(existsSync(resolve(ROOT, 'readme.md'))).toBe(true);
  });

  it('keeps the shared links intact', () => {
    const markdown = read('readme.md');
    expect(markdown).toContain('https://editxlsx.com');
    expect(markdown).toContain('[MIT](LICENSE)');
    expect(markdown).toContain('ghcr.io/ranuts/document:latest');
    expect(markdown).toContain('(NOTICE)');
  });
});
