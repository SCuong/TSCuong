import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { KeyValueList, Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { useDebouncedValue, useObjectUrl } from '@/lib/hooks';
import { downloadBlob, formatBytes } from '@/lib/utils';
import { DECODABLE, FORMAT_INFO, readImageHeader } from './lib/formats';
import { DataUrlError, extensionFor, parseDataUrl } from './lib/dataurl';
import { t } from '@/lib/i18n';

const SAMPLE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAN0lEQVR42mNgoAVQTX79HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCSqJGWqZCZSAQAcdn2IzbpOsAAAAABJRU5ErkJggg==';

export default function DataUrlToImage() {
  const [input, setInput] = useState('');
  const debounced = useDebouncedValue(input, 250);
  const [errorUrl, setErrorUrl] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!debounced.trim()) return null;
    try {
      return { ok: true as const, value: parseDataUrl(debounced) };
    } catch (e) {
      return { ok: false as const, error: e instanceof DataUrlError ? e.message : t('The input could not be decoded.') };
    }
  }, [debounced]);

  const value = parsed?.ok ? parsed.value : null;
  const header = value ? readImageHeader(value.bytes) : null;
  const blob = useMemo(
    () => (value?.detected ? new Blob([value.bytes as Uint8Array<ArrayBuffer>], { type: FORMAT_INFO[value.detected].mime }) : null),
    [value],
  );
  const url = useObjectUrl(blob);
  const imgError = url !== null && errorUrl === url;

  // <img> quietly shows a partial picture for truncated data, so decode it explicitly.
  const detected = value?.detected ?? null;
  useEffect(() => {
    if (!url || !blob || !detected) return;
    let cancelled = false;
    const check =
      detected === 'svg'
        ? (() => {
            const img = new Image();
            img.src = url;
            return img.decode();
          })()
        : createImageBitmap(blob).then((b) => b.close());
    check.catch(() => {
      if (!cancelled) setErrorUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [url, blob, detected]);
  const notImage = value && !value.detected;
  const mismatch = value?.detected && value.declaredMime && value.declaredMime !== FORMAT_INFO[value.detected].mime && !(value.detected === 'jpeg' && value.declaredMime === 'image/jpg');

  return (
    <ToolStack>
      <SplitPanes>
        <EditorPanel
          title={t('Data URL or Base64')}
          value={input}
          onChange={setInput}
          placeholder={t('data:image/png;base64,iVBORw0KGgo…  (also accepts raw Base64, CSS url(…), <img src=…> or Markdown)')}
          sample={SAMPLE}
          fileAccept=".txt,.css,.html,.md,text/plain"
          invalid={Boolean(parsed && !parsed.ok) || Boolean(notImage)}
          height="360px"
          footer={input ? <span>{t('{count} characters', { count: input.length.toLocaleString() })}</span> : undefined}
        />
        <Panel title={t('Image')} className="min-h-[420px]">
          {!parsed && <EmptyState title={t('Paste a data URL to preview it')}>{t('The image is decoded on this device.')}</EmptyState>}
          <ErrorMessage error={parsed && !parsed.ok ? parsed.error : null} title={t('Invalid input')} />
          {notImage && (
            <Alert tone="danger" title={t('Not a recognized image')}>
              {value.declaredMime
                ? t("The data decodes to {size} (declared as {declaredMime}), but it doesn't start with the signature of any supported image format.", {
                    size: formatBytes(value.bytes.length),
                    declaredMime: value.declaredMime,
                  })
                : t("The data decodes to {size}, but it doesn't start with the signature of any supported image format.", {
                    size: formatBytes(value.bytes.length),
                  })}
            </Alert>
          )}
          {value?.detected && url && (
            <div className="flex flex-col gap-3">
              {mismatch && (
                <Alert tone="warning">
                  {t('Declared as {declaredMime}, but the data is actually {label}.', { declaredMime: value.declaredMime, label: FORMAT_INFO[value.detected].label })}
                </Alert>
              )}
              {imgError ? (
                <Alert tone="danger">
                  {DECODABLE.has(value.detected) && value.detected !== 'avif'
                    ? t('The data looks like {label} but it can\'t be displayed: it is probably truncated or corrupt.', { label: FORMAT_INFO[value.detected].label })
                    : t('The data is {label}, which this browser can\'t display. You can still download it.', { label: FORMAT_INFO[value.detected].label })}
                </Alert>
              ) : (
                <div className="lk-checker flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-line p-3">
                  <img
                    src={url}
                    alt={t('Decoded')}
                    className="max-h-72 max-w-full object-contain"
                    style={header?.width && header.width < 64 && value.detected !== 'svg' ? { width: Math.round(header.width * 4), imageRendering: 'pixelated' } : undefined}
                    onError={() => setErrorUrl(url)}
                  />
                </div>
              )}
              <KeyValueList
                items={[
                  { label: t('Type'), value: `${FORMAT_INFO[value.detected].label} (${FORMAT_INFO[value.detected].mime})` },
                  { label: t('Dimensions'), value: header?.width && header.height ? `${Math.round(header.width)} × ${Math.round(header.height)} px` : 'Unknown' },
                  { label: t('Decoded size'), value: `${formatBytes(value.bytes.length)} (${value.bytes.length.toLocaleString()} bytes)` },
                  { label: t('Encoded length'), value: `${debounced.trim().length.toLocaleString()} characters` },
                ]}
              />
              <Button
                variant="primary"
                icon={Download}
                className="self-start"
                onClick={() => downloadBlob(blob!, `image.${extensionFor(value.detected, value.declaredMime)}`)}
              >
                {t('Download .{extensionFor}', { extensionFor: extensionFor(value.detected, value.declaredMime) })}
              </Button>
            </div>
          )}
        </Panel>
      </SplitPanes>
    </ToolStack>
  );
}
