import shell from './shell';
import tools from './tools';

/** Vietnamese interface text, keyed by the English source text passed to `t()`. */
const vi: Record<string, string> = { ...shell, ...tools };

export default vi;
