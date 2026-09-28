import { Braces } from 'lucide-react';
import type { ToolDefinition } from '../types';

export const jsonTools: ToolDefinition[] = [
  {
    id: 'json-formatter',
    name: 'JSON Formatter',
    description: 'Pretty-print or minify JSON with validation, custom indentation and key sorting.',
    category: 'json',
    icon: Braces,
    route: 'json-formatter',
    keywords: ['json', 'format', 'pretty', 'print', 'beautify', 'minify', 'indent', 'validate'],
    aliases: ['format json', 'json beautifier', 'pretty print json', 'json prettifier', 'json minifier'],
    load: () => import('../json/JsonFormatter'),
  },
];
