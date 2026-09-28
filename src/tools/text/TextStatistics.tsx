import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Stat } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { formatBytes, formatNumber } from '@/lib/utils';
import { formatMinutes, READING_WPM, SPEAKING_WPM, textStats } from './lib/stats';
import { TEXT_FILE_ACCEPT } from './components/shared';

const ID = 'text-statistics';
const SAMPLE = `The first draft of anything is rarely perfect. Writers revise, cut and rearrange until every sentence earns its place.

Counting words helps you hit a target length for essays, articles or social posts. Reading time estimates how long your audience needs — useful for newsletters and blog posts! 📚`;

export default function TextStatistics() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const deferred = useDeferredValue(input);
  const s = useMemo(() => textStats(deferred), [deferred]);
  const n = (v: number) => formatNumber(v, 0);

  return (
    <ToolStack>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Words" value={n(s.words)} />
        <Stat label="Characters" value={n(s.characters)} />
        <Stat label="Without spaces" value={n(s.charactersNoSpaces)} />
        <Stat label="Sentences" value={n(s.sentences)} />
        <Stat label="Paragraphs" value={n(s.paragraphs)} />
        <Stat label="Reading time" value={s.words ? formatMinutes(s.readingMinutes) : '—'} />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <EditorPanel
          title="Text"
          value={input}
          onChange={setInput}
          placeholder="Start typing or paste your text. Everything is counted live."
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="460px"
          ariaLabel="Text to count"
        />
        <Panel title="Details" bodyClassName="px-4 py-1">
          <dl className="divide-y divide-line text-[13px]">
            {[
              { label: 'Graphemes', value: n(s.graphemes) },
              { label: 'Code points', value: n(s.characters) },
              { label: 'UTF-16 units', value: n(s.utf16Units) },
              { label: 'Bytes (UTF-8)', value: `${n(s.bytes)}${s.bytes >= 1024 ? ` (${formatBytes(s.bytes)})` : ''}` },
              { label: 'Lines', value: n(s.lines) },
              { label: 'Unique words', value: n(s.uniqueWords) },
              { label: 'Avg. word length', value: s.words ? `${s.avgWordLength.toFixed(1)} chars` : '—' },
              { label: 'Avg. sentence', value: s.sentences ? `${s.avgSentenceWords.toFixed(1)} words` : '—' },
              { label: 'Longest word', value: s.longestWord ? <span className="break-all">{s.longestWord}</span> : '—' },
              { label: `Reading (${READING_WPM} wpm)`, value: s.words ? formatMinutes(s.readingMinutes) : '—' },
              { label: `Speaking (${SPEAKING_WPM} wpm)`, value: s.words ? formatMinutes(s.speakingMinutes) : '—' },
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
