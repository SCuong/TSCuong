import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Select, Switch } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { addAffixes, DEFAULT_AFFIX_OPTIONS, type AffixOptions, type QuoteStyle } from './lib/lines';
import { Opt, SampleButton, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';
import { t } from '@/lib/i18n';

const ID = 'add-prefix-suffix';
const SAMPLE = 'apple\nbanana\n\ncherry\ndragon fruit';

interface Settings extends Omit<AffixOptions, 'joinWith'> {
  join: boolean;
  joinWith: string;
}

const DEFAULTS: Settings = { ...DEFAULT_AFFIX_OPTIONS, join: false, joinWith: ', ' };

export default function PrefixSuffix() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [s, setS] = useToolState<Settings>(ID, 'settings', DEFAULTS);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));

  const deferred = useDeferredValue(input);
  const output = useMemo(
    () => addAffixes(deferred, { ...s, joinWith: s.join ? s.joinWith.replace(/\\n/g, '\n').replace(/\\t/g, '\t') : null }),
    [deferred, s],
  );

  function loadSample() {
    setInput(SAMPLE);
    if (!s.prefix && !s.suffix && s.quote === 'none') setS((o) => ({ ...o, quote: 'double', suffix: ',' }));
  }

  return (
    <ToolStack>
      <ToolBar>
        <Opt label={t('Prefix')} className="w-40">
          <Input value={s.prefix} onChange={(e) => set('prefix', e.target.value)} mono placeholder="e.g. - " aria-label={t('Prefix')} />
        </Opt>
        <Opt label={t('Suffix')} className="w-40">
          <Input value={s.suffix} onChange={(e) => set('suffix', e.target.value)} mono placeholder="e.g. ," aria-label={t('Suffix')} />
        </Opt>
        <Opt label={t('Wrap in quotes')}>
          <Select value={s.quote} onChange={(e) => set('quote', e.target.value as QuoteStyle)} aria-label={t('Wrap in quotes')} className="w-40">
            <option value="none">{t('No quotes')}</option>
            <option value="single">{t('\'Single\'')}</option>
            <option value="double">{t('"Double"')}</option>
            <option value="backtick">{t('`Backtick`')}</option>
          </Select>
        </Opt>
        {s.join && (
          <Opt label={t('Join with')} className="w-28">
            <Input value={s.joinWith} onChange={(e) => set('joinWith', e.target.value)} mono aria-label={t('Join with')} />
          </Opt>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label={t('Skip empty lines')} checked={s.skipEmpty} onChange={(v) => set('skipEmpty', v)} />
          <Switch label={t('Trim lines')} checked={s.trim} onChange={(v) => set('trim', v)} />
          <Switch label={t('Escape quotes')} checked={s.escapeQuotes} onChange={(v) => set('escapeQuotes', v)} disabled={s.quote === 'none'} />
          <Switch label={t('Join into one line')} checked={s.join} onChange={(v) => set('join', v)} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title={t('Lines')}
          value={input}
          onChange={setInput}
          placeholder={t('One item per line…')}
          actions={<SampleButton onClick={loadSample} />}
          fileAccept={TEXT_FILE_ACCEPT}
          height="400px"
          lineWrapping={false}
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title={t('Result')}
          value={output}
          placeholder={t('Result appears here')}
          downloadName="lines.txt"
          height="400px"
          lineWrapping={s.join}
          footer={<TextFooter text={output} />}
        />
      </SplitPanes>
    </ToolStack>
  );
}
