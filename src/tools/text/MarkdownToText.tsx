import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Switch } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { DEFAULT_MD_OPTIONS, markdownToText, type MarkdownToTextOptions } from './lib/markdown';
import { TextFooter } from './components/shared';

const ID = 'markdown-to-text';
const SAMPLE = `# Release notes

We're excited to ship **version 2.0** of the _LocalKit_ toolbox. Read the [full changelog](https://example.com/changelog).

## Highlights

- Faster \`JSON\` formatting
- New **text** tools:
  1. Case converter
  2. Text diff
- [x] Works offline
- [ ] Mobile app

> Everything runs locally &mdash; nothing is uploaded.

| Tool | Status |
|------|--------|
| Diff | ✅ Ready |
| OCR  | 🧪 Beta |

\`\`\`bash
npm install localkit
\`\`\`

![Screenshot of the app](https://example.com/shot.png)
`;

export default function MarkdownToText() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [o, setO] = useToolState<MarkdownToTextOptions>(ID, 'options', DEFAULT_MD_OPTIONS);
  const set = <K extends keyof MarkdownToTextOptions>(key: K, value: MarkdownToTextOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));

  const deferred = useDeferredValue(input);
  const output = useMemo(() => markdownToText(deferred, o), [deferred, o]);

  return (
    <ToolStack>
      <ToolBar>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-1">
          <Switch label="Keep list markers" checked={o.listMarkers} onChange={(v) => set('listMarkers', v)} />
          <Switch label="Show link URLs" checked={o.linkUrls} onChange={(v) => set('linkUrls', v)} />
          <Switch label="Keep code blocks" checked={o.codeBlocks} onChange={(v) => set('codeBlocks', v)} />
          <Switch label="Keep image alt text" checked={o.imageAlt} onChange={(v) => set('imageAlt', v)} />
          <Switch label="UPPERCASE headings" checked={o.uppercaseHeadings} onChange={(v) => set('uppercaseHeadings', v)} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Markdown"
          value={input}
          onChange={setInput}
          language="markdown"
          placeholder="Paste Markdown…"
          sample={SAMPLE}
          fileAccept=".md,.markdown,.mdx,.txt,text/markdown,text/plain"
          height="480px"
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title="Plain text"
          value={output}
          placeholder="Clean text appears here"
          downloadName="text.txt"
          height="480px"
          footer={<TextFooter text={output} />}
        />
      </SplitPanes>
    </ToolStack>
  );
}
