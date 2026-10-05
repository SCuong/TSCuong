import { t } from '@/lib/i18n';
import { usePdfWorkspace } from './PdfWorkspaceContext';
export function useRasterLimits() {
  const mobile = Boolean(usePdfWorkspace());
  return mobile ? { maxPixels: 12_000_000, maxSide: 8192 } : {};
}
export function MobileRasterNotice() {
  return usePdfWorkspace() ? <p className="text-[12px] leading-relaxed text-fg-secondary">{t('Rasterized pages are limited to 12 megapixels and 8192 pixels per side in the mobile toolkit to protect device memory. Larger pages use a lower effective DPI.')}</p> : null;
}
