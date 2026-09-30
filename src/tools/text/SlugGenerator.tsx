import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, NumberInput, Switch } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/Actions';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { makeSlugs } from './lib/slug';
import { countCodePoints } from './lib/common';
import { Opt, TEXT_FILE_ACCEPT } from './components/shared';
import { OutputPanel } from './components/OutputPanel';
import { useTask } from './components/useTask';
import { t } from '@/lib/i18n';

const ID = 'slug-generator';
/** A slug is short; a huge pasted text only shows its beginning (Copy has all of it). */
const MAX_SHOWN = 5_000;
const SAMPLE_SINGLE = 'Crème Brûlée: 10 Easy Recipes & Tips for Beginners!';
const SAMPLE_BULK = 'Hello World!\nCrème Brûlée à la carte\nStraße & Øresund Bridge\nПривет, мир\n10 Tips for Writing Clean Code (2025 Edition)';

export default function SlugGenerator() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [bulk, setBulk] = useToolState(ID, 'bulk', false);
  const [separator, setSeparator] = useToolState(ID, 'separator', '-');
  const [lowercase, setLowercase] = useToolState(ID, 'lowercase', true);
  const [maxLength, setMaxLength] = useToolState<number | ''>(ID, 'maxLength', '');
  const [translit, setTranslit] = useToolState(ID, 'transliterate', true);
  const [keepUnicode, setKeepUnicode] = useToolState(ID, 'keepUnicode', false);
  const [umlauts, setUmlauts] = useToolState(ID, 'umlauts', false);
  const [symbols, setSymbols] = useToolState(ID, 'symbols', true);

  const deferred = useDeferredValue(input);
  const opts = useMemo(
    () => ({
      separator,
      lowercase,
      maxLength: typeof maxLength === 'number' ? maxLength : 0,
      transliterate: translit,
      keepUnicode,
      germanUmlauts: umlauts,
      symbols,
    }),
    [separator, lowercase, maxLength, translit, keepUnicode, umlauts, symbols],
  );
  const task = useTask('makeSlugs', makeSlugs, [deferred, bulk, opts], { size: deferred.length });
  const output = task.value ?? '';
  const count = useMemo(() => (bulk ? output.split('\n').filter(Boolean).length : 0), [bulk, output]);

  return (
    <ToolStack>
      <ToolBar>
        <Opt label={t('Mode')}>
          <Segmented
            label={t('Mode')}
            value={bulk ? 'bulk' : 'single'}
            onChange={(v) => setBulk(v === 'bulk')}
            options={[
              { value: 'single', label: t('Single') },
              { value: 'bulk', label: t('One per line') },
            ]}
          />
        </Opt>
        <Opt label={t('Separator')} className="w-24">
          <Input value={separator} onChange={(e) => setSeparator(e.target.value.slice(0, 5))} mono aria-label={t('Separator')} />
        </Opt>
        <Opt label={t('Max length')} className="w-28">
          <NumberInput value={maxLength} onChange={setMaxLength} min={0} placeholder={t('No limit')} aria-label={t('Maximum length')} />
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label={t('Lowercase')} checked={lowercase} onChange={setLowercase} />
          <Switch label={t('Transliterate accents')} checked={translit} onChange={setTranslit} />
          <Switch label={t('ä → ae')} checked={umlauts} onChange={setUmlauts} disabled={!translit} />
          <Switch label={t('& → and')} checked={symbols} onChange={setSymbols} disabled={!translit} />
          <Switch label={t('Keep non-Latin letters')} checked={keepUnicode} onChange={setKeepUnicode} />
        </div>
      </ToolBar>

      {bulk ? (
        <SplitPanes>
          <EditorPanel
            title={t('Titles')}
            value={input}
            onChange={setInput}
            placeholder={t('One title per line…')}
            sample={SAMPLE_BULK}
            fileAccept={TEXT_FILE_ACCEPT}
            height="360px"
          />
          <OutputPanel
            title={t('Slugs')}
            value={output}
            placeholder={t('Slugs appear here')}
            downloadName="slugs.txt"
            height="360px"
            busy={task.pending}
            footer={output ? <span>{pluralize(count, t('slug'), t('slugs'))}</span> : undefined}
          />
        </SplitPanes>
      ) : (
        <>
          <EditorPanel
            title={t('Title or phrase')}
            value={input}
            onChange={setInput}
            placeholder={t('Type a title, e.g. “My First Blog Post!”')}
            sample={SAMPLE_SINGLE}
            height="110px"
          />
          <Panel
            title={t('Slug')}
            actions={<CopyButton value={output} />}
            description={output ? `${pluralize(countCodePoints(output), t('character'), t('characters'))}` : undefined}
          >
            {output ? (
              <p className="font-mono text-[15px] break-all text-fg">
                {output.length > MAX_SHOWN ? `${output.slice(0, MAX_SHOWN)}…` : output}
              </p>
            ) : (
              <p className="text-[13px] text-fg-muted">
                {!deferred.trim()
                  ? t('Your slug appears here as you type.')
                  : task.pending
                    ? t('Generating…')
                    : !keepUnicode && /\p{L}/u.test(deferred)
                    ? t('None of these letters has a Latin spelling. Turn on “Keep non-Latin letters” to keep them in the slug.')
                    : t('The text has no letters or digits that can be used in a slug.')}
              </p>
            )}
          </Panel>
        </>
      )}
    </ToolStack>
  );
}
