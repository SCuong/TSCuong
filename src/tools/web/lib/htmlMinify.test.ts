import { describe, expect, it } from 'vitest';
import { DEFAULT_HTML_OPTIONS, HtmlMinifyError, defaultHooks, minifyHtml, tokenize, type HtmlMinifyOptions } from './htmlMinify';
import { byteLength, lineColumn, sizeSavings } from './sizes';

const plain: HtmlMinifyOptions = { ...DEFAULT_HTML_OPTIONS, minifyCss: false, minifyJs: false };
const m = (html: string, o: Partial<HtmlMinifyOptions> = {}) => minifyHtml(html, { ...plain, ...o });
const full = (html: string) => minifyHtml(html, DEFAULT_HTML_OPTIONS, defaultHooks());

describe('comments', () => {
  it('removes normal comments', async () => {
    expect(await m('<p>a<!-- note -->b</p>')).toBe('<p>ab</p>');
    expect(await m('<div>\n  <!-- x -->\n  <p>a</p>\n</div>')).toBe('<div><p>a</p></div>');
  });

  it('keeps conditional comments', async () => {
    const cond = '<!--[if lt IE 9]><script src="html5shiv.js"></script><![endif]-->';
    expect(await m(`<head>${cond}</head>`)).toBe(`<head>${cond}</head>`);
    expect(await m('<!--[if !IE]><!--><p>x</p><!--<![endif]-->')).toBe('<!--[if !IE]><!--><p>x</p><!--<![endif]-->');
  });

  it('keeps bang comments when asked', async () => {
    expect(await m('<!--! MIT license --><p>x</p>')).toBe('<!--! MIT license --><p>x</p>');
    expect(await m('<!--! MIT license --><p>x</p>', { keepBangComments: false })).toBe('<p>x</p>');
  });

  it('can keep all comments', async () => {
    expect(await m('<p>a<!-- keep --></p>', { removeComments: false })).toBe('<p>a<!-- keep --></p>');
  });

  it('merges text around removed comments without joining words', async () => {
    expect(await m('<p>a <!-- x --> b</p>')).toBe('<p>a b</p>');
  });

  it('errors on unclosed comments with a location', async () => {
    await expect(m('<p>\n  <!-- open')).rejects.toThrow(HtmlMinifyError);
    await expect(m('<p>\n  <!-- open')).rejects.toThrow(/Line 2, column 3/);
  });
});

describe('whitespace', () => {
  it('collapses whitespace between block elements', async () => {
    expect(await m('<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>')).toBe('<ul><li>One</li><li>Two</li></ul>');
  });

  it('keeps a single space between inline elements and text', async () => {
    expect(await m('<p>Hello   <b>big</b>   <i>world</i>  !</p>')).toBe('<p>Hello <b>big</b> <i>world</i> !</p>');
    expect(await m('<p><a href="#">a</a>\n<a href="#">b</a></p>')).toBe('<p><a href="#">a</a> <a href="#">b</a></p>');
  });

  it('trims whitespace at block boundaries', async () => {
    expect(await m('<div>\n   text  \n</div>')).toBe('<div>text</div>');
    expect(await m('  <p>x</p>  ')).toBe('<p>x</p>');
  });

  it('does not join words across inline tags', async () => {
    expect(await m('<p>foo <span>bar</span> baz</p>')).toBe('<p>foo <span>bar</span> baz</p>');
    expect(await m('<p>foo<span> bar </span>baz</p>')).toBe('<p>foo<span> bar </span>baz</p>');
  });

  it('keeps spaces around script and style (not block-level)', async () => {
    expect(await m('<p>a <script>x()</script> b</p>')).toBe('<p>a <script>x()</script> b</p>');
  });

  it('preserves <pre> content including nested tags', async () => {
    const pre = '<pre>\n  line 1\n    <b>line  2</b>\n</pre>';
    expect(await m(`<div>\n${pre}\n</div>`)).toBe(`<div>${pre}</div>`);
  });

  it('preserves <textarea> content', async () => {
    expect(await m('<textarea>\n  a   b\n</textarea>')).toBe('<textarea>\n  a   b\n</textarea>');
  });

  it('leaves whitespace alone when collapsing is off', async () => {
    expect(await m('<p>a   b</p>\n', { collapseWhitespace: false })).toBe('<p>a   b</p>\n');
  });

  it('handles Unicode, emoji and entities', async () => {
    expect(await m('<p>  héllo   🎉 &amp; &nbsp; </p>')).toBe('<p>héllo 🎉 &amp; &nbsp;</p>');
  });
});

describe('tags and attributes', () => {
  it('normalizes attribute spacing and keeps values', async () => {
    expect(await m('<a   href="/x?a=1&amp;b=2"\n   title=\'It "works"\'  data-x=unquoted   hidden>x</a>')).toBe(
      '<a href="/x?a=1&amp;b=2" title=\'It "works"\' data-x=unquoted hidden>x</a>',
    );
  });

  it('keeps > inside quoted attribute values', async () => {
    expect(await m('<div data-rule="a > b" title=\'x>y\'>z</div>')).toBe('<div data-rule="a > b" title=\'x>y\'>z</div>');
  });

  it('collapses whitespace in class values', async () => {
    expect(await m('<div class="  a\n   b  c ">x</div>')).toBe('<div class="a b c">x</div>');
  });

  it('keeps self-closing syntax safely', async () => {
    expect(await m('<br/><img src="a.png" />')).toBe('<br/><img src="a.png"/>');
    expect(await m('<svg><path d="M0 0"/></svg>')).toBe('<svg><path d="M0 0"/></svg>');
    expect(await m('<img src=a.png />')).toBe('<img src=a.png />');
  });

  it('keeps uppercase tag names and doctype', async () => {
    expect(await m('<!DOCTYPE   html>\n<HTML><BODY><P>x</P></BODY></HTML>')).toBe('<!DOCTYPE html><HTML><BODY><P>x</P></BODY></HTML>');
  });

  it('keeps CDATA', async () => {
    expect(await m('<svg><![CDATA[ a  <  b ]]></svg>')).toBe('<svg><![CDATA[ a  <  b ]]></svg>');
  });

  it('treats a stray < as text', async () => {
    expect(await m('<p>1 < 2</p>')).toBe('<p>1 < 2</p>');
  });

  it('errors on unterminated tags and quotes', async () => {
    await expect(m('<div class="a>text')).rejects.toThrow(/missing its closing " quote/);
    await expect(m('<div class=a')).rejects.toThrow(/not closed/);
  });

  it('handles empty input', async () => {
    expect(await m('')).toBe('');
    expect(await m('   \n  ')).toBe('');
  });
});

describe('script and style', () => {
  it('leaves script and style content intact without hooks', async () => {
    const html = '<style>\n a { color : red }\n</style><script>\n  if (a <b) { x() }\n</script>';
    expect(await m(html)).toBe(html);
  });

  it('finds the real end of a script even with tags inside strings', async () => {
    const html = '<script>document.write("<div>  x  </div>")</script><p> y </p>';
    expect(await m(html)).toBe('<script>document.write("<div>  x  </div>")</script><p>y</p>');
  });

  it('minifies inline CSS and style attributes', async () => {
    expect(await full('<style>\n  a { color: #ff0000; margin: 0px }\n</style>')).toBe('<style>a{color:red;margin:0}</style>');
    expect(await full('<p style="color: #ff0000 ;  margin : 0px">x</p>')).toBe('<p style="color:red;margin:0">x</p>');
  });

  it('minifies inline JS, including modules', async () => {
    const out = await full('<script>\n  function greet(name) {\n    return "Hi " + name;\n  }\n  greet("a");\n</script>');
    expect(out.length).toBeLessThan(80);
    expect(out.startsWith('<script>')).toBe(true);
    const mod = await full('<script type="module">\n  import { x } from "./x.js";\n  export const y = x + 1;\n</script>');
    expect(mod).toContain('import');
  });

  it('never emits </script> inside minified script', async () => {
    const out = await full('<script>var s = "</" + "script>"; var t = "<\\/script>";</script>');
    expect(out.match(/<\/script>/gi)).toHaveLength(1);
  });

  it('minifies JSON-LD safely and leaves unknown types alone', async () => {
    expect(await full('<script type="application/ld+json">\n{ "@type": "Thing", "name": "</script-ish>" }\n</script>')).toBe(
      '<script type="application/ld+json">{"@type":"Thing","name":"\\u003c/script-ish>"}</script>',
    );
    const tpl = '<script type="text/template">\n  <div>  {{ x }} </div>\n</script>';
    expect(await full(tpl)).toBe(tpl);
  });

  it('reports inline script errors', async () => {
    await expect(full('<script>let = ;</script>')).rejects.toThrow(/Inline script error/);
  });
});

describe('full documents', () => {
  it('minifies a realistic page and saves bytes', async () => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>  Demo   page </title>
    <!-- styles -->
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <main class="  wrap ">
      <h1>Hello, <em>world</em>!</h1>
      <p>
        Some   text with a <a href="/x">link</a>.
      </p>
    </main>
    <script>
      document.querySelector('h1').addEventListener('click', function () { alert('hi'); });
    </script>
  </body>
</html>
`;
    const out = await full(html);
    expect(out).toContain('<title>Demo page</title>');
    expect(out).toContain('<h1>Hello, <em>world</em>!</h1>');
    expect(out).toContain('<p>Some text with a <a href="/x">link</a>.</p>');
    expect(out).toContain('<main class="wrap">');
    expect(out).not.toContain('<!-- styles -->');
    expect(sizeSavings(html, out).ratio).toBeGreaterThan(0.25);
  });

  it('is idempotent', async () => {
    const once = await full('<div>\n <p> a  <b>b</b> </p>\n</div>');
    expect(await full(once)).toBe(once);
  });

  it('handles large input', async () => {
    const big = '<ul>\n' + '  <li>item   <b>x</b>  </li>\n'.repeat(20000) + '</ul>';
    const out = await m(big);
    expect(out.startsWith('<ul><li>item <b>x</b></li>')).toBe(true);
  });
});

describe('tokenize', () => {
  it('produces raw text tokens for script/style/textarea', () => {
    const types = tokenize('<style>a{}</style><textarea>x</textarea>').map((t) => t.type);
    expect(types).toEqual(['open', 'rawtext', 'close', 'open', 'rawtext', 'close']);
  });
});

describe('sizes', () => {
  it('counts UTF-8 bytes', () => {
    expect(byteLength('é')).toBe(2);
    expect(byteLength('🎉')).toBe(4);
    expect(sizeSavings('aaaa', 'aa')).toEqual({ before: 4, after: 2, saved: 2, ratio: 0.5 });
    expect(sizeSavings('', '').ratio).toBe(0);
  });

  it('computes line and column', () => {
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    expect(lineColumn('abc', 0)).toEqual({ line: 1, column: 1 });
  });
});
