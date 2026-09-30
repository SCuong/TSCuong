import { useDeferredValue } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { convertQuotes, DEFAULT_SMART_OPTIONS, type SmartOptions } from './lib/quotes';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';
import { OutputPanel } from './components/OutputPanel';
import { useTask } from './components/useTask';
import { t } from '@/lib/i18n';

const ID = 'smart-quotes';
const SAMPLE_STRAIGHT = `"Don't worry," she said -- "it's only the '90s... isn't it?"
He replied: 'Rock 'n' roll never dies' --- and left.`;
const SAMPLE_CURLY = `“Don’t worry,” she said – “it’s only the ’90s… isn’t it?”
He replied: ‘Rock ’n’ roll never dies’ — and left.`;

type Direction = 'smart' | 'straight';

export default function SmartQuotes() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'smart');
  const [o, setO] = useToolState<SmartOptions>(ID, 'options', DEFAULT_SMART_OPTIONS);
  const set = <K extends keyof SmartOptions>(key: K, value: SmartOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));

  const deferred = useDeferredValue(input);
  const task = useTask('convertQuotes', convertQuotes, [deferred, direction, o], { size: deferred.length });
  const output = task.value?.text ?? '';
  const marks = task.value?.marks ?? 0;

  return (
    <ToolStack>
      <ToolBar>
        <Opt label={t('Convert')}>
          <Segmented
            label={t('Direction')}
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'smart', label: t('Straight → curly') },
              { value: 'straight', label: t('Curly → straight') },
            ]}
          />
        </Opt>
        <Opt label={t('Dashes')}>
          <Select value={o.dashes} onChange={(e) => set('dashes', e.target.value as SmartOptions['dashes'])} aria-label={t('Dashes')} className="w-56">
            <option value="oldschool">{t('--- ↔ — (em), -- ↔ – (en)')}</option>
            <option value="em">{t('-- ↔ — (em dash)')}</option>
            <option value="off">{t('Leave dashes alone')}</option>
          </Select>
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label={t('Quotes & apostrophes')} checked={o.quotes} onChange={(v) => set('quotes', v)} />
          <Switch label={t('Ellipsis (... ↔ …)')} checked={o.ellipsis} onChange={(v) => set('ellipsis', v)} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title={t('Input')}
          value={input}
          onChange={setInput}
          placeholder={direction === 'smart' ? t('Paste text with "straight" quotes…') : t('Paste text with “curly” quotes…')}
          sample={direction === 'smart' ? SAMPLE_STRAIGHT : SAMPLE_CURLY}
          fileAccept={TEXT_FILE_ACCEPT}
          height="360px"
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title={t('Result')}
          value={output}
          placeholder={t('Converted text appears here')}
          downloadName="text.txt"
          height="360px"
          busy={task.pending}
          footer={
            input && task.value ? (
              <span>{direction === 'smart' ? t('{count} in the result', { count: pluralize(marks, t('typographic mark'), t('typographic marks')) }) : t('{count} replaced', { count: pluralize(marks, t('typographic mark'), t('typographic marks')) })}</span>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
