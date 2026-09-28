import { createContext, useContext } from 'react';
import type { ToolDefinition } from './types';

export const ToolContext = createContext<ToolDefinition | null>(null);

/** The tool currently being rendered. Throws when used outside a tool page. */
export function useCurrentTool(): ToolDefinition {
  const tool = useContext(ToolContext);
  if (!tool) throw new Error('useCurrentTool must be used inside a tool page');
  return tool;
}
