import { t } from '@/lib/i18n';
export function pageRangeMessage(message: string) {
  let match = /^Page (\d+) does not exist: the document has (\d+) pages?\.$/.exec(message);
  if (match) return t('Page {page} does not exist: the document has {total} pages.', { page: match[1], total: match[2] });
  match = /^"(.+)" is not a page number\.$/.exec(message);
  if (match) return t('"{value}" is not a page number.', { value: match[1] });
  match = /^"(.+)" is not a valid range\.(.*)$/.exec(message);
  if (match) return t('"{value}" is not a valid range. Separate ranges with commas.', { value: match[1] });
  return t(message);
}
