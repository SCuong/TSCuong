import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export type CategoryId =
  | 'workspace'
  | 'pdf'
  | 'image'
  | 'json'
  | 'text'
  | 'encoding'
  | 'data'
  | 'web'
  | 'color'
  | 'security'
  | 'generators'
  | 'datetime'
  | 'network'
  | 'git'
  | 'qr'
  | 'math'
  | 'files';

export interface CategoryDefinition {
  id: CategoryId;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Hue (0–360) used for the category's icon tint in both themes. */
  hue: number;
}

/** Browser capabilities a tool depends on. Checked at runtime before the tool renders. */
export type BrowserRequirement =
  | 'fileSystemAccess'
  | 'offscreenCanvas'
  | 'webCrypto'
  | 'camera'
  | 'clipboardRead'
  | 'webAssembly'
  | 'indexedDB';

/**
 * How a tool uses the network:
 * - `none`: everything happens on this device.
 * - `optional`: works locally; some explicitly triggered action may use the network.
 * - `required`: the tool's purpose is to talk to a server (e.g. the API client).
 */
export type NetworkUse = 'none' | 'optional' | 'required';

export interface ToolDefinition {
  /** Stable unique id. Never rename: favorites and history reference it. */
  id: string;
  name: string;
  /** One sentence shown in cards, search results and the tool header. */
  description: string;
  category: CategoryId;
  icon: LucideIcon;
  /** Path below `/tools/`, e.g. `json-formatter` or `pdf/merge`. */
  route: string;
  /** Search terms: formats, verbs and nouns people type. */
  keywords: string[];
  /** Alternative names and natural phrases, e.g. "pretty print json". */
  aliases?: string[];
  load: () => Promise<{ default: ComponentType }>;
  network?: NetworkUse;
  /** Explains what `network` means for this specific tool. */
  networkNote?: string;
  requires?: BrowserRequirement[];
  /** Workspace-style tools get the full content width and manage their own padding. */
  layout?: 'standard' | 'wide' | 'full';
  /**
   * Small search prior (1–3) for the flagship tool of a family, so a bare query like "json" or
   * "regex" puts the formatter/tester first instead of breaking ties alphabetically. It never
   * outweighs a better textual match.
   */
  priority?: number;
}
