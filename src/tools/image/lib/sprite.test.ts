import { describe, expect, it } from 'vitest';
import { classNames, gridLayout, hasOverlap, packLayout, sheetFileName, spriteCss, spriteJson } from './sprite';

const sizes = [
  { name: 'home.png', width: 32, height: 32 },
  { name: 'search.png', width: 24, height: 24 },
  { name: 'banner.png', width: 120, height: 40 },
  { name: 'dot.png', width: 8, height: 8 },
  { name: 'tall.png', width: 16, height: 64 },
];

function within(layout: ReturnType<typeof gridLayout>) {
  return layout.items.every((i) => i.x >= 0 && i.y >= 0 && i.x + i.width <= layout.width && i.y + i.height <= layout.height);
}

describe('sprite layouts', () => {
  it('grid layout uses uniform cells with padding', () => {
    const l = gridLayout(sizes, 3, 2);
    expect(l.width).toBe(2 + 3 * (120 + 2));
    expect(l.height).toBe(2 + 2 * (64 + 2));
    expect(hasOverlap(l.items)).toBe(false);
    expect(within(l)).toBe(true);
    expect(l.items[0]).toMatchObject({ x: 2 + 44, y: 2 + 16 });
  });

  it('grid clamps columns', () => {
    expect(gridLayout(sizes, 99, 0).width).toBe(5 * 120);
    expect(gridLayout(sizes, 0, 0).width).toBe(120);
  });

  it('packed layout has no overlaps, respects padding and keeps input order', () => {
    for (const pad of [0, 1, 4]) {
      const l = packLayout(sizes, pad);
      expect(hasOverlap(l.items.map((i) => ({ ...i, x: i.x - pad / 2, y: i.y - pad / 2, width: i.width + pad, height: i.height + pad })))).toBe(false);
      expect(within(l)).toBe(true);
      expect(l.items.map((i) => i.name)).toEqual(sizes.map((s) => s.name));
    }
  });

  it('packs many random rectangles without overlap and reasonably tight', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const many = Array.from({ length: 200 }, (_, i) => ({ name: `s${i}`, width: 4 + Math.floor(rnd() * 60), height: 4 + Math.floor(rnd() * 60) }));
    const l = packLayout(many, 1);
    expect(hasOverlap(l.items)).toBe(false);
    expect(within(l)).toBe(true);
    const used = many.reduce((n, s) => n + s.width * s.height, 0);
    expect(used / (l.width * l.height)).toBeGreaterThan(0.55);
  });

  it('handles empty input', () => {
    expect(gridLayout([], 4, 2)).toEqual({ width: 0, height: 0, items: [] });
    expect(packLayout([], 2)).toEqual({ width: 0, height: 0, items: [] });
  });
});

describe('sprite outputs', () => {
  it('makes safe unique class names', () => {
    expect(classNames(['Home Icon.png', 'home-icon.svg', 'Café.png', '1st.png', '😀.png'])).toEqual(['home-icon', 'home-icon-2', 'cafe', 'i1st', 'sprite']);
  });

  it('writes CSS with background positions', () => {
    const l = gridLayout(sizes.slice(0, 2), 2, 0);
    const css = spriteCss(l, 'icon', 'sprite.png');
    expect(css).toContain('.icon {');
    expect(css).toContain('background-image: url("sprite.png");');
    expect(css).toContain('.icon-home {\n  width: 32px;\n  height: 32px;\n  background-position: 0 0;\n}');
    expect(css).toContain(`.icon-search {\n  width: 24px;\n  height: 24px;\n  background-position: -${l.items[1].x}px -${l.items[1].y}px;`);
  });

  it('writes a JSON frame map', () => {
    const l = packLayout(sizes, 0);
    const j = JSON.parse(spriteJson(l, 'sheet.png'));
    expect(Object.keys(j.frames)).toHaveLength(5);
    expect(j.frames.dot.frame).toEqual({ x: l.items[3].x, y: l.items[3].y, w: 8, h: 8 });
    expect(j.meta).toMatchObject({ image: 'sheet.png', size: { w: l.width, h: l.height } });
  });
});

describe('sheet file name', () => {
  it('always ends in .png and is safe in a ZIP and in CSS (regression: "icons" had no extension)', () => {
    expect(sheetFileName('icons')).toBe('icons.png');
    expect(sheetFileName('icons.PNG')).toBe('icons.PNG');
    expect(sheetFileName('  ')).toBe('sprite.png');
    expect(sheetFileName('a/b:c?.png')).toBe('a-b-c-.png');
    expect(sheetFileName('..hidden')).toBe('hidden.png');
    expect(sheetFileName('name.')).toBe('name.png');
  });
  it('escapes quotes in the CSS url()', () => {
    const css = spriteCss(packLayout([{ name: 'a.png', width: 1, height: 1 }], 0), 'icon', 'my"sheet.png');
    expect(css).toContain('background-image: url("my\\"sheet.png");');
  });
});
