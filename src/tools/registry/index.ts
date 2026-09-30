import type { CategoryId, ToolDefinition } from '../types';
import { CATEGORIES, getCategory } from '../categories';
import { createSearchIndex } from '@/lib/search';
import { t } from '@/lib/i18n';
import { workspaceTools } from './workspace';
import { workspaceSnippetsTools } from './workspace-snippets';
import { workspaceDataTools } from './workspace-data';
import { workspaceApiTools } from './workspace-api';
import { pdfTools } from './pdf';
import { imageTools } from './image';
import { jsonTools } from './json';
import { textTools } from './text';
import { encodingTools } from './encoding';
import { dataTools } from './data';
import { webTools } from './web';
import { colorTools } from './color';
import { securityTools } from './security';
import { generatorsTools } from './generators';
import { datetimeTools } from './datetime';
import { networkTools } from './network';
import { gitTools } from './git';
import { qrTools } from './qr';
import { mathTools } from './math';
import { filesTools } from './files';

/**
 * The single source of truth for every tool. Navigation, search, the command
 * palette, the home page and the sitemap are all generated from this list.
 * Only metadata lives here; implementations load lazily via `tool.load()`.
 */
export const TOOLS: ToolDefinition[] = [
  ...workspaceTools,
  ...workspaceSnippetsTools,
  ...workspaceDataTools,
  ...workspaceApiTools,
  ...pdfTools,
  ...imageTools,
  ...jsonTools,
  ...textTools,
  ...encodingTools,
  ...dataTools,
  ...webTools,
  ...colorTools,
  ...securityTools,
  ...generatorsTools,
  ...datetimeTools,
  ...networkTools,
  ...gitTools,
  ...qrTools,
  ...mathTools,
  ...filesTools,
];

const byId = new Map(TOOLS.map((tool) => [tool.id, tool]));
const byRoute = new Map(TOOLS.map((tool) => [tool.route, tool]));
/** Redirect paths never shadow a real route. */
const byRedirect = new Map(
  TOOLS.flatMap((tool) => (tool.redirectFrom ?? []).filter((r) => !byRoute.has(r)).map((r) => [r, tool] as const)),
);

export function getTool(id: string): ToolDefinition | undefined {
  return byId.get(id);
}

/** Resolves a path below `/tools/`, following `redirectFrom` aliases (check `tool.route` to detect a redirect). */
export function getToolByRoute(route: string): ToolDefinition | undefined {
  const path = route.replace(/^\/+|\/+$/g, '');
  return byRoute.get(path) ?? byRedirect.get(path);
}

export function toolPath(tool: ToolDefinition): string {
  return `/tools/${tool.route}`;
}

export function toolsInCategory(category: CategoryId): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.category === category);
}

/** Categories that have at least one tool, in display order. */
export function populatedCategories() {
  return CATEGORIES.filter((c) => TOOLS.some((t) => t.category === c.id));
}

/** Resolve stored ids to tools, silently dropping ids of tools that no longer exist. */
export function resolveTools(ids: string[]): ToolDefinition[] {
  return ids.map((id) => byId.get(id)).filter((t): t is ToolDefinition => Boolean(t));
}

/** A search index in the current interface language (English terms always match too). */
export function createToolSearchIndex() {
  return createSearchIndex(
    TOOLS,
    (id) => {
      const category = getCategory(id as CategoryId);
      return `${t(category.name)} ${category.name}`;
    },
    t,
  );
}

// Built on first use: this module loads before the interface language does.
let index: ReturnType<typeof createToolSearchIndex> | null = null;

export function searchTools(query: string, limit?: number) {
  index ??= createToolSearchIndex();
  return index.search(query, limit);
}

/** Warm the chunk for a tool (e.g. on hover/focus) so opening it feels instant. */
const preloaded = new Set<string>();
export function preloadTool(tool: ToolDefinition) {
  if (preloaded.has(tool.id)) return;
  preloaded.add(tool.id);
  tool.load().catch(() => preloaded.delete(tool.id));
}
