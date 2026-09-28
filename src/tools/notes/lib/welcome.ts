/** The note created on first run. It doubles as a tour of what the editor supports. */
export const WELCOME_TAGS = ['welcome', 'guide'];

export const WELCOME_NOTE = `# Welcome to Markdown Notes

Notes are written in **Markdown**, saved automatically in this browser and never uploaded. This note is a quick tour: edit it, or delete it once you know your way around.

## Formatting

Use **bold** (Ctrl+B), *italic* (Ctrl+I), ~~strikethrough~~, \`inline code\` and [links](https://commonmark.org/help/).

> Block quotes are handy for citations and callouts.

## Task lists

Click a checkbox in the preview to tick it off; the Markdown updates too.

- [x] Open Markdown Notes
- [ ] Create a note with **Ctrl+Alt+N**
- [ ] Add a tag and filter the list by it
- [ ] Export a note as Markdown or HTML

## Tables

| Shortcut | Action |
| --- | --- |
| Ctrl+S | Save now |
| Ctrl+B / Ctrl+I | Bold / italic |
| Ctrl+Alt+N | New note |
| Ctrl+P | Print or save as PDF |

## Code with syntax highlighting

\`\`\`ts
function readingTime(words: number, wpm = 220): number {
  return Math.max(1, Math.round(words / wpm));
}
\`\`\`

## Diagrams

Fenced \`mermaid\` blocks render as diagrams:

\`\`\`mermaid
flowchart LR
  write[Write Markdown] --> save[(Saved in this browser)]
  save --> export[Export .md or .html]
  save --> print[Print or PDF]
\`\`\`

## Search, tags and favorites

- Search looks through titles, tags and note text.
- Star a note to keep it in **Favorites**.
- Import existing \`.md\` files with the import button; front matter \`title\` and \`tags\` are kept.
`;
