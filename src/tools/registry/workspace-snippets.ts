import { SquareCode } from 'lucide-react';
import type { ToolDefinition } from '../types';

export const workspaceSnippetsTools: ToolDefinition[] = [
  {
    id: 'snippets',
    name: 'Snippet Manager',
    description: 'Save, tag, search and copy reusable code snippets in 50+ languages, stored privately in your browser.',
    category: 'workspace',
    icon: SquareCode,
    route: 'snippets',
    keywords: [
      'snippet',
      'snippets',
      'code snippets',
      'gist',
      'code library',
      'boilerplate',
      'template',
      'clipboard',
      'tags',
      'search',
      'favorites',
      'import',
      'export',
      'json',
      'syntax highlighting',
    ],
    aliases: ['code snippet manager', 'save code snippets', 'snippet library', 'local gist', 'code notes', 'cheat sheet'],
    load: () => import('../snippets/SnippetManager'),
    requires: ['indexedDB'],
    layout: 'full',
  },
];
