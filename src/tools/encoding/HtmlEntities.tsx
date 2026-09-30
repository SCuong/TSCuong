import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { decodeEntitiesCounted, encodeEntitiesCounted, type EntityFormat, type EntityScope } from './lib/htmlEntities';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';
import { useTask } from '../text/components/useTask';
import { t } from '@/lib/i18n';

const ID = 'html-entities';
const SAMPLE_ENCODE = `<p class="note">Tom & Jerry's "café" — €5 © 2025 😀</p>`;
const SAMPLE_DECODE = '&lt;p class=&quot;note&quot;&gt;Tom &amp; Jerry&#39;s &ldquo;caf&eacute;&rdquo; &mdash; &euro;5 &copy; 2025 &#x1F600;&lt;/p&gt;';

export default function HtmlEntities() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [format, setFormat] = useToolState<EntityFormat>(ID, 'format', 'named');
  const [scope, setScope] = useToolState<EntityScope>(ID, 'scope', 'special');

  const deferred = useDeferredValue(input);
  // Encoding runs in a worker for large texts; decoding uses the page's own HTML parser.
  const encoded = useTask('encodeEntitiesCounted', encodeEntitiesCounted, direction === 'encode' && deferred ? [deferred, { format, scope }] : null, {
    size: deferred.length,
  });
  const decoded = useMemo(() => (direction === 'decode' && deferred ? decodeEntitiesCounted(deferred) : null), [direction, deferred]);
  const result = direction === 'encode' ? encoded.value : decoded;
  const output = result?.text ?? '';
  const refs = result?.count ?? 0;

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionControls direction={direction} onDirection={setDirection} onSwap={swap} canSwap={Boolean(output) && !(direction === 'encode' && encoded.pending)} />
        {direction === 'encode' ? (
          <>
            <Opt label={t('Encode')}>
              <Select value={scope} onChange={(e) => setScope(e.target.value as EntityScope)} aria-label={t('Characters to encode')} className="w-64">
                <option value="special">{t('Only & < > " \'')}</option>
                <option value="nonAscii">{t('Special + all non-ASCII')}</option>
                <option value="all">{t('All but letters, digits, spaces')}</option>
              </Select>
            </Opt>
            <Opt label={t('Format')}>
              <Segmented
                label={t('Entity format')}
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'named', label: t('Named') },
                  { value: 'decimal', label: t('Decimal') },
                  { value: 'hex', label: t('Hex') },
                ]}
              />
            </Opt>
          </>
        ) : (
          <p className="pb-2 text-[12.5px] text-fg-muted">
            {t('Decodes all 2,231 named HTML5 references plus decimal and hex forms, exactly like a browser. No markup is rendered.')}
          </p>
        )}
      </ToolBar>
      <ErrorMessage error={direction === 'encode' ? encoded.error : null} title={t('Could not encode this text')} />
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? t('Text or HTML') : t('Encoded HTML')}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? t('Text to escape for HTML…') : t('Text with &amp;entities; to decode…')}
          sample={direction === 'encode' ? SAMPLE_ENCODE : SAMPLE_DECODE}
          fileAccept={`${TEXT_FILE_ACCEPT},.html,.htm,.xml,.svg`}
          height="320px"
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title={direction === 'encode' ? t('Encoded') : t('Decoded')}
          value={output}
          placeholder={t('Result appears here')}
          downloadName={direction === 'encode' ? 'encoded.html' : 'decoded.txt'}
          downloadType={direction === 'encode' ? 'text/html;charset=utf-8' : undefined}
          height="320px"
          busy={direction === 'encode' && encoded.pending}
          footer={
            input && result ? (
              <span>
                {direction === 'encode' ? t('{count} created', { count: pluralize(refs, t('entity'), t('entities')) }) : t('{count} decoded', { count: pluralize(refs, t('entity'), t('entities')) })}
              </span>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
