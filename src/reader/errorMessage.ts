import { getLocale, t } from '@/lib/i18n';

/** Localize the shared loader's dynamic errors without changing desktop PDF tools. */
export function readerErrorMessage(message: string, fileName?: string) {
  if (getLocale() === 'en') return message;
  const name = fileName ?? t('PDF document');
  if (/password is not correct/i.test(message)) return t('That PDF password is incorrect. Try again.');
  if (/larger than 512 MB/i.test(message))
    return t('"{name}" exceeds 512 MB. This browser cannot safely open it.', { name });
  if (/is empty/i.test(message)) return t('"{name}" is empty. Pick another PDF.', { name });
  if (/is not a PDF/i.test(message)) return t('"{name}" is not a valid PDF. Pick a PDF document.', { name });
  if (/damaged|Invalid PDF/i.test(message))
    return t('"{name}" is damaged and cannot be opened. Try another copy.', { name });
  if (/could not be read/i.test(message))
    return t('"{name}" could not be read. Pick it again from Files or Downloads.', { name });
  return t('Could not open "{name}". Try another copy of this PDF.', { name });
}
