import { useDeferredValue, useMemo, useState } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { NumberInput, Select, Switch } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { utf8Bytes } from '../convert/lib/common';
import { ErrorPanel, MoreOptionsToggle, Option, TextStats, useEditorView, useProblemMarkers } from '../convert/shared/ConvertUi';
import { DIALECTS, dialectInfo, type SqlDialect } from './lib/dialects';
import { DEFAULT_FORMAT_SETTINGS, type CaseOption, type IndentStyle, type SqlFormatSettings } from './lib/sqlFormat';
import { minifySql } from './lib/sqlMinify';
import { useSqlFormatter } from './useSqlFormatter';
import { t } from '@/lib/i18n';

const TOOL = 'sql-formatter';

const SAMPLE = `-- Monthly revenue by customer segment
with orders_2024 as (select o.id, o.customer_id, o.total_cents, date_trunc('month', o.created_at) as month from orders o where o.created_at >= '2024-01-01' and o.status <> 'cancelled'),
segments as (select c.id, case when c.lifetime_value > 100000 then 'enterprise' when c.lifetime_value > 10000 then 'business' else 'self-serve' end as segment from customers c)
select s.segment, o.month, count(distinct o.customer_id) as customers, sum(o.total_cents) / 100.0 as revenue /* in dollars */
from orders_2024 o join segments s on s.id = o.customer_id
group by s.segment, o.month having sum(o.total_cents) > 0 order by o.month, revenue desc;`;

type Mode = 'format' | 'minify';
type Backslash = 'auto' | 'on' | 'off';

interface MinifySettings {
  keepHints: boolean;
  backslash: Backslash;
}

const CASE_OPTIONS: Array<{ value: CaseOption; label: string }> = [
  { value: 'upper', label: 'UPPER' },
  { value: 'lower', label: 'lower' },
  { value: 'preserve', label: t('As written') },
];

export default function SqlFormatter() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [mode, setMode] = useToolState<Mode>(TOOL, 'mode', 'format');
  const [s, setS] = useToolState<SqlFormatSettings>(TOOL, 'settings', DEFAULT_FORMAT_SETTINGS);
  const [m, setM] = useToolState<MinifySettings>(TOOL, 'minify', { keepHints: true, backslash: 'auto' });
  const [more, setMore] = useState(false);
  const set = <K extends keyof SqlFormatSettings>(key: K, value: SqlFormatSettings[K]) => setS((o) => ({ ...o, [key]: value }));
  const editor = useEditorView();

  const deferred = useDeferredValue(input);
  const formatted = useSqlFormatter(deferred, s, mode === 'format');
  const minified = useMemo(() => {
    if (mode !== 'minify' || !deferred.trim()) return null;
    return minifySql(deferred, {
      dialect: s.dialect,
      keepHints: m.keepHints,
      backslashEscapes: m.backslash === 'auto' ? undefined : m.backslash === 'on',
    });
  }, [mode, deferred, s.dialect, m]);

  const outcome = mode === 'format' ? formatted.outcome : minified;
  const output = outcome?.ok ? outcome.value : '';
  const error = outcome && !outcome.ok ? outcome.error : null;
  const markers = useProblemMarkers(error);
  const dialectBackslash = dialectInfo(s.dialect).lex.backslashEscapes;
  const inBytes = useMemo(() => utf8Bytes(deferred), [deferred]);
  const outBytes = useMemo(() => utf8Bytes(output), [output]);

  return (
    <ToolStack>
      <ToolBar>
        <Option label={t('Mode')}>
          <Segmented
            label={t('Mode')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'format', label: t('Format') },
              { value: 'minify', label: t('Minify') },
            ]}
          />
        </Option>
        <Option label={t('Dialect')} htmlFor="sqlf-dialect" className="w-48">
          <Select id="sqlf-dialect" value={s.dialect} onChange={(e) => set('dialect', e.target.value as SqlDialect)} className="h-8 py-1 text-[13px]">
            {DIALECTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </Option>
        {mode === 'format' ? (
          <>
            <Option label={t('Keywords')}>
              <Segmented label={t('Keywords')} value={s.keywordCase} onChange={(v) => set('keywordCase', v)} options={CASE_OPTIONS} />
            </Option>
            <Option label={t('Indent')}>
              <Segmented
                label={t('Indent')}
                value={s.indent}
                onChange={(v) => set('indent', v)}
                options={[
                  { value: '2', label: '2' },
                  { value: '4', label: '4' },
                  { value: 'tab', label: 'Tab' },
                ]}
              />
            </Option>
            <Option label={t('Blank lines between statements')} htmlFor="sqlf-lines" className="w-52">
              <Select id="sqlf-lines" value={String(s.linesBetweenQueries)} onChange={(e) => set('linesBetweenQueries', Number(e.target.value))} className="h-8 py-1 text-[13px]">
                <option value="0">{t('None')}</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </Select>
            </Option>
            <MoreOptionsToggle open={more} onToggle={() => setMore((v) => !v)} controls="sqlf-more" />
            {more && (
              <div id="sqlf-more" className="flex w-full min-w-0 flex-wrap items-end gap-x-4 gap-y-3 border-t border-line pt-3">
                <Option label={t('Function names')} htmlFor="sqlf-fn" className="w-36">
                  <Select id="sqlf-fn" value={s.functionCase} onChange={(e) => set('functionCase', e.target.value as CaseOption)} className="h-8 py-1 text-[13px]">
                    {CASE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Option>
                <Option label={t('Data types')} htmlFor="sqlf-types" className="w-36">
                  <Select id="sqlf-types" value={s.dataTypeCase} onChange={(e) => set('dataTypeCase', e.target.value as CaseOption)} className="h-8 py-1 text-[13px]">
                    {CASE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Option>
                <Option label={t('Layout')} htmlFor="sqlf-layout" className="w-44">
                  <Select id="sqlf-layout" value={s.indentStyle} onChange={(e) => set('indentStyle', e.target.value as IndentStyle)} className="h-8 py-1 text-[13px]">
                    <option value="standard">{t('Standard')}</option>
                    <option value="tabularLeft">{t('Tabular, keywords left')}</option>
                    <option value="tabularRight">{t('Tabular, keywords right')}</option>
                  </Select>
                </Option>
                <Option label="AND / OR" htmlFor="sqlf-logic" className="w-40">
                  <Select
                    id="sqlf-logic"
                    value={s.logicalOperatorNewline}
                    onChange={(e) => set('logicalOperatorNewline', e.target.value as 'before' | 'after')}
                    className="h-8 py-1 text-[13px]"
                  >
                    <option value="before">{t('Start of line')}</option>
                    <option value="after">{t('End of line')}</option>
                  </Select>
                </Option>
                <Option label={t('Inline width')} htmlFor="sqlf-width" className="w-28">
                  <NumberInput
                    id="sqlf-width"
                    min={10}
                    max={200}
                    value={s.expressionWidth}
                    onChange={(v) => set('expressionWidth', v === '' ? DEFAULT_FORMAT_SETTINGS.expressionWidth : v)}
                    className="h-8 py-1 text-[13px]"
                    title={t('Parenthesized expressions shorter than this stay on one line')}
                  />
                </Option>
                <Switch label={t('Dense operators (a=b)')} checked={s.denseOperators} onChange={(v) => set('denseOperators', v)} className="h-8" />
                <Switch label={t('Semicolon on its own line')} checked={s.newlineBeforeSemicolon} onChange={(v) => set('newlineBeforeSemicolon', v)} className="h-8" />
                <Switch label={t('Jinja / dbt templates ({{ }})')} checked={s.templates} onChange={(v) => set('templates', v)} className="h-8" />
              </div>
            )}
          </>
        ) : (
          <>
            <Option label={t('Backslash in strings')} htmlFor="sqlf-bs" className="w-56">
              <Select id="sqlf-bs" value={m.backslash} onChange={(e) => setM((o) => ({ ...o, backslash: e.target.value as Backslash }))} className="h-8 py-1 text-[13px]">
                <option value="auto">{t('Dialect default ({value})', { value: dialectBackslash ? t('Escape character') : t('Plain character') })}</option>
                <option value="on">{t('Escape character (\\\')')}</option>
                <option value="off">{t('Plain character')}</option>
              </Select>
            </Option>
            <Switch
              label={t('Keep optimizer hints (/*+ */, /*! */)')}
              checked={m.keepHints}
              onChange={(v) => setM((o) => ({ ...o, keepHints: v }))}
              className="h-8"
            />
          </>
        )}
      </ToolBar>

      <ErrorPanel title={mode === 'format' ? t('Could not format this SQL') : t('Could not minify this SQL')} error={error} onReveal={() => editor.reveal(error?.line, error?.column)} />

      <SplitPanes>
        <EditorPanel code
          title="SQL"
          value={input}
          onChange={setInput}
          language="sql"
          placeholder={t('Paste SQL to format or minify…')}
          sample={SAMPLE}
          fileAccept=".sql,.ddl,.pgsql,.psql,.mysql,.hql,.txt,application/sql,text/plain"
          invalid={Boolean(error)}
          height="480px"
          extensions={markers}
          onReady={editor.onReady}
          footer={input ? <TextStats text={input} /> : undefined}
        />
        <EditorPanel
          title={
            <span className="inline-flex items-center gap-2">
              {mode === 'format' ? t('Formatted SQL') : t('Minified SQL')}
              {mode === 'format' && formatted.busy && <Spinner size={13} label={t('Formatting…')} />}
            </span>
          }
          ariaLabel={mode === 'format' ? t('Formatted SQL') : t('Minified SQL')}
          value={output}
          language="sql"
          downloadName={mode === 'format' ? 'query.sql' : 'query.min.sql'}
          downloadType="application/sql"
          placeholder={error ? t('Fix the error to see the result') : t('The result appears here')}
          height="480px"
          lineWrapping={mode === 'minify'}
          footer={
            output ? (
              <TextStats
                text={output}
                extra={
                  <>
                    {mode === 'minify' && inBytes > 0 && <span>{t('{max}% smaller', { max: Math.max(0, Math.round((1 - outBytes / inBytes) * 100)) })}</span>}
                    {mode === 'minify' && minified?.ok && minified.commentsRemoved > 0 && (
                      <span>
                        {(minified.commentsRemoved === 1) ? t('{commentsRemoved} comment removed', { commentsRemoved: minified.commentsRemoved }) : t('{commentsRemoved} comments removed', { commentsRemoved: minified.commentsRemoved })}
                      </span>
                    )}
                  </>
                }
              />
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
