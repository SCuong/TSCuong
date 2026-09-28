import { describe, expect, it } from 'vitest';
import { optimize } from 'svgo/browser';
import { analyzeSvg, buildSvgoConfig, presetToggles } from './svg';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe('analyzeSvg', () => {
  it('reads size from width/height and viewBox', () => {
    const a = analyzeSvg(`<svg ${NS} width="64" height="32" viewBox="0 0 128 64"><rect width="1" height="1"/></svg>`);
    expect(a).toMatchObject({ ok: true, width: '64', height: '32', viewBox: '0 0 128 64', size: { width: 64, height: 32 }, elements: 2 });
    expect(a.warnings).toEqual([]);
  });

  it('derives size from the viewBox when width/height are missing', () => {
    const a = analyzeSvg(`<svg ${NS} viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`);
    expect(a.size).toEqual({ width: 24, height: 24 });
    const b = analyzeSvg(`<svg ${NS} width="48" viewBox="0,0,24,12"/>`);
    expect(b.size).toEqual({ width: 48, height: 24 });
  });

  it('reports invalid XML and non-SVG roots', () => {
    expect(analyzeSvg('<svg><g></svg>').error).toMatch(/Invalid XML/);
    expect(analyzeSvg(`<html ${NS}></html>`).error).toMatch(/root element/);
    expect(analyzeSvg('   ').error).toMatch(/empty/);
  });

  it('warns about scripts, handlers, external refs, missing viewBox and namespace', () => {
    const a = analyzeSvg(
      `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><script>alert(1)</script><rect onclick="x()"/><image href="https://example.com/a.png"/><foreignObject/></svg>`,
    );
    const w = a.warnings.join('\n');
    expect(w).toMatch(/script/);
    expect(w).toMatch(/event handler/);
    expect(w).toMatch(/external reference/);
    expect(w).toMatch(/foreignObject/);
    expect(w).toMatch(/No viewBox/);
    expect(analyzeSvg('<svg width="1" height="1" viewBox="0 0 1 1"/>').warnings.join()).toMatch(/xmlns/);
  });

  it('handles Unicode text content', () => {
    expect(analyzeSvg(`<svg ${NS} viewBox="0 0 10 10"><text>héllo 😀</text></svg>`).ok).toBe(true);
  });
});

describe('SVGO config', () => {
  const input = `<?xml version="1.0"?>
<!-- comment -->
<svg ${NS} width="100" height="100" viewBox="0 0 100 100">
  <title>Logo</title>
  <metadata>junk</metadata>
  <g><g><rect x="10.123456" y="10" width="80" height="80" fill="#ff0000"/></g></g>
  <script>alert(1)</script>
</svg>`;

  it('default preset shrinks the SVG and keeps title and viewBox', () => {
    const out = optimize(input, buildSvgoConfig({ preset: 'default', multipass: true, precision: 3, pretty: false, plugins: presetToggles('default') })).data;
    expect(out.length).toBeLessThan(input.length);
    expect(out).not.toContain('comment');
    expect(out).not.toContain('metadata');
    expect(out).toContain('<title>Logo</title>');
    expect(out).toContain('viewBox="0 0 100 100"');
    expect(out).toContain('red');
  });

  it('aggressive preset removes scripts, title and dimensions', () => {
    const out = optimize(input, buildSvgoConfig({ preset: 'aggressive', multipass: true, precision: 1, pretty: false, plugins: presetToggles('aggressive') })).data;
    expect(out).not.toContain('script');
    expect(out).not.toContain('<title>');
    expect(out).not.toContain('width="100"');
    expect(out).toContain('viewBox');
  });

  it('disabling a preset plugin becomes an override', () => {
    const cfg = buildSvgoConfig({ preset: 'default', multipass: false, precision: 2, pretty: true, plugins: { ...presetToggles('default'), removeComments: false } });
    expect(cfg.plugins?.[0]).toEqual({ name: 'preset-default', params: { overrides: { removeComments: false } } });
    const out = optimize(input, cfg).data;
    expect(out).toContain('comment');
    expect(out.split('\n').length).toBeGreaterThan(2);
  });

  it('safe preset disables id/path-merging plugins', () => {
    const t = presetToggles('safe');
    expect(t.cleanupIds).toBe(false);
    expect(t.mergePaths).toBe(false);
    expect(t.removeComments).toBe(true);
  });
});
