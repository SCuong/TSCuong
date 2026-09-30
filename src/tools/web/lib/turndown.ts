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

/**
 * Escapes text that Markdown renderers would otherwise read as markup: `<div>` written as text would
 * become an HTML tag and `&amp;` an entity, so the rendered Markdown would lose or change it.
 */
export function escapeHtmlLikeText(text: string): string {
  return text.replace(/<(?=[A-Za-z/!?])/g, '\\<').replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');
}

/**
 * Content for one GFM table cell: a `|` would end the cell and a line break would end the row,
 * so pipes are escaped and line breaks become `<br>` (paragraphs `<br><br>`).
 */
export function tableCellContent(content: string): string {
  return content
    .trim()
    .replace(/\|/g, '\\|')
    .replace(/[ \t]*\n[ \t]*\n\s*/g, '<br><br>')
    .replace(/[ \t]*\n[ \t]*/g, '<br>');
}

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
  const escape = service.escape.bind(service);
  service.escape = (text: string) => escapeHtmlLikeText(escape(text));
  if (options.gfm) {
    service.use(gfm);
    // Rules added later take precedence over the plugin's.
    // GFM strikethrough is ~~text~~; single tildes are subscript in Pandoc and unsupported by many renderers.
    service.addRule('strikethrough', { filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName), replacement: (content) => `~~${content}~~` });
    service.addRule('tableCell', {
      filter: ['th', 'td'],
      replacement: (content, node) => {
        const index = Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node);
        return `${index === 0 ? '| ' : ' '}${tableCellContent(content)} |`;
      },
    });
  }
  return service.turndown(clean).trim() + '\n';
}
