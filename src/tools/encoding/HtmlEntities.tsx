import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { countEntities, decodeEntities, encodeEntities, type EntityFormat, type EntityScope } from './lib/htmlEntities';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';

const ID = 'html-entities';
const SAMPLE_ENCODE = `<p class="note">Tom & Jerry's "café" — €5 © 2025 😀</p>`;
const SAMPLE_DECODE = '&lt;p class=&quot;note&quot;&gt;Tom &amp; Jerry&#39;s &ldquo;caf&eacute;&rdquo; &mdash; &euro;5 &copy; 2025 &#x1F600;&lt;/p&gt;';

export default function HtmlEntities() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [format, setFormat] = useToolState<EntityFormat>(ID, 'format', 'named');
  const [scope, setScope] = useToolState<EntityScope>(ID, 'scope', 'special');

  const deferred = useDeferredValue(input);
  const output = useMemo(
    () => (!deferred ? '' : direction === 'encode' ? encodeEntities(deferred, { format, scope }) : decodeEntities(deferred)),
    [deferred, direction, format, scope],
  );
  const refs = useMemo(() => countEntities(direction === 'encode' ? output : deferred), [direction, output, deferred]);

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionControls direction={direction} onDirection={setDirection} onSwap={swap} canSwap={Boolean(output)} />
        {direction === 'encode' ? (
          <>
            <Opt label="Encode">
              <Select value={scope} onChange={(e) => setScope(e.target.value as EntityScope)} aria-label="Characters to encode" className="w-60">
                <option value="special">Only &amp; &lt; &gt; &quot; &#39;</option>
                <option value="nonAscii">Special + all non-ASCII</option>
                <option value="all">Everything except letters & digits</option>
              </Select>
            </Opt>
            <Opt label="Format">
              <Segmented
                label="Entity format"
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'named', label: 'Named' },
                  { value: 'decimal', label: 'Decimal' },
                  { value: 'hex', label: 'Hex' },
                ]}
              />
            </Opt>
          </>
        ) : (
          <p className="pb-2 text-[12.5px] text-fg-muted">
            Decodes all 2,231 named HTML5 references plus decimal and hex forms, exactly like a browser. No markup is rendered.
          </p>
        )}
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? 'Text or HTML' : 'Encoded HTML'}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? 'Text to escape for HTML…' : 'Text with &amp;entities; to decode…'}
          sample={direction === 'encode' ? SAMPLE_ENCODE : SAMPLE_DECODE}
          fileAccept={`${TEXT_FILE_ACCEPT},.html,.htm,.xml,.svg`}
          height="320px"
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title={direction === 'encode' ? 'Encoded' : 'Decoded'}
          value={output}
          placeholder="Result appears here"
          downloadName={direction === 'encode' ? 'encoded.html' : 'decoded.txt'}
          downloadType={direction === 'encode' ? 'text/html;charset=utf-8' : undefined}
          height="320px"
          footer={input ? <span>{direction === 'encode' ? `${pluralize(refs, 'entity', 'entities')} created` : `${pluralize(refs, 'entity', 'entities')} decoded`}</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
