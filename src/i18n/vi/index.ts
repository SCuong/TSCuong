import shell from './shell';
import tools from './tools';
import pdf from './pdf';

/** Vietnamese interface text, keyed by the English source text passed to `t()`. */
const vi: Record<string, string> = { ...shell, ...tools, ...pdf };

export default vi;
