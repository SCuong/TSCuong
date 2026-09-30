import shell from './shell';
import tools from './tools';
import pdf from './pdf';
import image from './image';
import json from './json';

/** Vietnamese interface text, keyed by the English source text passed to `t()`. */
const vi: Record<string, string> = Object.assign({}, shell, tools, pdf, image, json);

export default vi;
