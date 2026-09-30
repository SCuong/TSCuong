import { useDeferredValue } from 'react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Feedback';
import { Panel, Stat } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { formatBytes, formatNumber } from '@/lib/utils';
import { formatMinutes, READING_WPM, SPEAKING_WPM, textStats } from './lib/stats';
import { TEXT_FILE_ACCEPT } from './components/shared';
import { useTask } from './components/useTask';
import { t } from '@/lib/i18n';

const ID = 'text-statistics';
const SAMPLE = `The first draft of anything is rarely perfect. Writers revise, cut and rearrange until every sentence earns its place.

Counting words helps you hit a target length for essays, articles or social posts. Reading time estimates how long your audience needs — useful for newsletters and blog posts! 📚`;

const EMPTY = textStats('');

export default function TextStatistics() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const deferred = useDeferredValue(input);
  const task = useTask('textStats', textStats, [deferred], { size: deferred.length });
  const s = task.value ?? EMPTY;
  const n = (v: number) => formatNumber(v, 0);

  return (
    <ToolStack>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-busy={task.pending || undefined}>
        <Stat label={t('Words')} value={n(s.words)} />
        <Stat label={t('Characters')} value={n(s.characters)} />
        <Stat label={t('Without spaces')} value={n(s.charactersNoSpaces)} />
        <Stat label={t('Sentences')} value={n(s.sentences)} />
        <Stat label={t('Paragraphs')} value={n(s.paragraphs)} />
        <Stat label={t('Reading time')} value={s.words ? formatMinutes(s.readingMinutes) : '—'} />
      </div>
      <ErrorMessage error={task.error} title={t('Could not count this text')} />
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <EditorPanel
          title={t('Text')}
          value={input}
          onChange={setInput}
          placeholder={t('Start typing or paste your text. Everything is counted live.')}
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="460px"
          ariaLabel={t('Text to count')}
        />
        <Panel
          title={t('Details')}
          description={t('Characters count what you see: an emoji or an accented letter is one character.')}
          actions={task.pending ? <Spinner size={14} label={t('Counting…')} /> : undefined}
          bodyClassName="px-4 py-1"
        >
          <dl className="divide-y divide-line text-[13px]">
            {[
              { label: t('Code points'), value: n(s.codePoints) },
              { label: t('UTF-16 units'), value: n(s.utf16Units) },
              { label: t('Bytes (UTF-8)'), value: `${n(s.bytes)}${s.bytes >= 1024 ? ` (${formatBytes(s.bytes)})` : ''}` },
              { label: t('Lines'), value: n(s.lines) },
              { label: t('Unique words'), value: n(s.uniqueWords) },
              { label: t('Avg. word length'), value: s.words ? `${s.avgWordLength.toFixed(1)} chars` : '—' },
              { label: t('Avg. sentence'), value: s.sentences ? `${s.avgSentenceWords.toFixed(1)} words` : '—' },
              { label: t('Longest word'), value: s.longestWord ? <span className="break-all">{s.longestWord}</span> : '—' },
              { label: t('Reading ({READING_WPM} wpm)', { READING_WPM }), value: s.words ? formatMinutes(s.readingMinutes) : '—' },
              { label: t('Speaking ({SPEAKING_WPM} wpm)', { SPEAKING_WPM }), value: s.words ? formatMinutes(s.speakingMinutes) : '—' },
            ].map((item) => (
              <div key={item.label} className="flex items-baseline justify-between gap-4 py-2">
                <dt className="shrink-0 text-fg-muted">{item.label}</dt>
                <dd className="min-w-0 text-right font-mono text-[12.5px] text-fg tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </ToolStack>
  );
}
