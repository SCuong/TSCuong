import { t } from '@/lib/i18n';
export const PDF_PROGRESS_LABELS = ['Saving', 'Reading documents', 'Arranging pages', 'Numbering pages', 'Adding watermark', 'Finding unused objects', 'Compressing streams', 'Saving with object streams', 'Adding text layer', 'Reading fonts', 'Exporting annotations', 'Building the searchable PDF', 'Loading the OCR engine', 'Starting the OCR engine', 'Loading English language data', 'Preparing recognition', 'Recognizing text'];
export function pdfProgressText(label: string) {
  if (PDF_PROGRESS_LABELS.includes(label)) return t(label);
  let match = /^(Reading|Merging) (.+)$/.exec(label);
  if (match && !match[2].startsWith('page ')) return match[1] === 'Reading' ? t('Reading {name}', { name: match[2] }) : t('Merging {name}', { name: match[2] });
  match = /^(Creating file|Adding image|Preparing image) (\d+) of (\d+)$/.exec(label);
  if (match) return match[1] === 'Creating file' ? t('Creating file {index} of {total}', { index: match[2], total: match[3] }) : match[1] === 'Adding image' ? t('Adding image {index} of {total}', { index: match[2], total: match[3] }) : t('Preparing image {index} of {total}', { index: match[2], total: match[3] });
  match = /^(Rendering|Recognizing|Reading) page (\d+)(?: \((\d+) of (\d+)\)| of (\d+))?$/.exec(label);
  if (match) {
    const page = match[2], total = match[4] ?? match[5];
    const status = match[1] === 'Rendering' ? t('Rendering page {page}', { page }) : match[1] === 'Recognizing' ? t('Recognizing page {page}', { page }) : t('Reading page {page}', { page });
    return total ? status + ' · ' + (match[3] ?? page) + '/' + total : status;
  }
  match = /^Scanning page (\d+) · (.+) found$/.exec(label);
  return match ? t('Scanning page {page} · {count} found', { page: match[1], count: match[2] }) : t(label);
}
