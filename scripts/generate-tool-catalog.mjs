// Generates docs/TOOLS.md from the tool registry, so the catalog can never drift
// from what the app actually ships. Usage: npm run docs:tools
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const { TOOLS, toolsInCategory } = await server.ssrLoadModule('/src/tools/registry/index.ts');
  const { CATEGORIES } = await server.ssrLoadModule('/src/tools/categories.ts');

  const lines = [
    '# Tool catalog',
    '',
    `LocalKit ships **${TOOLS.length} tools** in ${CATEGORIES.length} categories. This file is generated from the`,
    'registry by `npm run docs:tools`; do not edit it by hand.',
    '',
    'Every tool runs on your device. The Network column marks the few that can make requests, and only when you ask them to (see [PRIVACY.md](PRIVACY.md)).',
    '',
  ];
  for (const category of CATEGORIES) {
    const tools = toolsInCategory(category.id);
    if (!tools.length) continue;
    lines.push(`## ${category.name} (${tools.length})`, '', category.description, '', '| Tool | Route | What it does | Network |', '| --- | --- | --- | --- |');
    for (const tool of tools) {
      const net = tool.network === 'required' ? 'When you send a request' : tool.network === 'optional' ? 'Only for resources you reference' : '—';
      const description = tool.description.replace(/\|/g, '\\|');
      lines.push(`| ${tool.name} | \`/tools/${tool.route}\` | ${description} | ${net} |`);
    }
    lines.push('');
  }
  writeFileSync(new URL('../docs/TOOLS.md', import.meta.url), lines.join('\n'));
  console.log(`docs/TOOLS.md: ${TOOLS.length} tools`);
} finally {
  await server.close();
}
