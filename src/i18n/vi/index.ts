import shell from './shell';
import tools from './tools';
import pdf from './pdf';
import image from './image';
import json from './json';
import text from './text';
import encoding from './encoding';
import data from './data';
import web from './web';

/** Vietnamese interface text, keyed by the English source text passed to `t()`. */
const vi: Record<string, string> = Object.assign({}, shell, tools, pdf, image, json, text, encoding, data, web);

export default vi;
