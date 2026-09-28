import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export interface HtmlToMarkdownOptions {
  headingStyle: 'atx' | 'setext';
  bulletListMarker: '-' | '*' | '+';
  codeBlockStyle: 'fenced' | 'indented';
  fence: '```' | '~~~';
  emDelimiter: '_' | '*';
  strongDelimiter: '**' | '__';
  linkStyle: 'inlined' | 'referenced';
  gfm: boolean;
}

export const DEFAULT_TURNDOWN: HtmlToMarkdownOptions = {
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined',
  gfm: true,
};

/** Sanitizes HTML (dropping scripts, styles and event handlers) and converts it to Markdown. */
export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions): string {
  if (!html.trim()) return '';
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'title'] });
  const service = new TurndownService({
    headingStyle: options.headingStyle,
    bulletListMarker: options.bulletListMarker,
    codeBlockStyle: options.codeBlockStyle,
    fence: options.fence,
    emDelimiter: options.emDelimiter,
    strongDelimiter: options.strongDelimiter,
    linkStyle: options.linkStyle,
    hr: '---',
  });
  if (options.gfm) service.use(gfm);
  return service.turndown(clean).trim() + '\n';
}
