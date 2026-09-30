/** Builds the srcdoc for the live preview. Scripts are only included when `runScripts` is true. */
export function buildPreviewDocument(html: string, css: string, js: string, runScripts: boolean, consoleToken?: string): string {
  const style = css.trim() ? `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>` : '';
  const bridge = runScripts && consoleToken ? `<script>${consoleBridge(consoleToken)}</script>` : '';
  const script = runScripts && js.trim() ? `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>` : '';
  const head = `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${bridge}${style}`;
  // `<head` must not match `<header>`.
  const HEAD = /<head(?=[\s>/])[^>]*>/i;
  const HTML = /<html(?=[\s>/])[^>]*>/i;

  if (HTML.test(html) || /<!doctype/i.test(html)) {
    // A full document: inject into <head> and before </body>.
    let doc = HEAD.test(html) ? html.replace(HEAD, (m) => `${m}\n${head}`) : html.replace(HTML, (m) => `${m}\n<head>${head}</head>`);
    if (!HTML.test(doc) && !HEAD.test(html)) {
      doc = /<!doctype[^>]*>/i.test(doc) ? doc.replace(/<!doctype[^>]*>/i, (m) => `${m}\n${head}`) : `${head}\n${doc}`;
    }
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${script}\n</body>`) : `${doc}\n${script}`;
    return doc;
  }
  return `<!doctype html>\n<html>\n<head>\n${head}\n</head>\n<body>\n${html}\n${script}\n</body>\n</html>`;
}

/** Messages the preview posts to the page. `clear` empties the console panel. */
export interface ConsoleMessage {
  __lk: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'clear';
  text: string;
}

/**
 * Forwards console output and uncaught errors to the parent window, tagged with a token.
 * Values are printed like a browser console would: strings as-is, objects as JSON (with
 * circular references marked), and undefined, functions, symbols, BigInts and DOM nodes readably.
 */
export function consoleBridge(token: string): string {
  return `(function(){var t=${JSON.stringify(token)};
function j(v){var seen=[];return JSON.stringify(v,function(k,x){if(typeof x==='bigint')return x+'n';if(typeof x==='function')return 'ƒ '+(x.name||'anonymous')+'()';if(typeof x==='symbol')return String(x);if(x===undefined)return 'undefined';if(typeof Node!=='undefined'&&x instanceof Node)return '<'+x.nodeName.toLowerCase()+'>';if(x instanceof Error)return x.name+': '+x.message;if(typeof x==='object'&&x!==null){if(seen.indexOf(x)>=0)return '[Circular]';seen.push(x)}return x},1)}
function f(v){try{if(typeof v==='string')return v;if(v===undefined)return 'undefined';if(typeof v==='function')return 'ƒ '+(v.name||'anonymous')+'()';if(typeof v==='symbol')return String(v);if(typeof v==='bigint')return v+'n';if(v instanceof Error)return v.name+': '+v.message;if(typeof Node!=='undefined'&&v instanceof Node)return v.outerHTML?String(v.outerHTML).slice(0,300):'<'+v.nodeName.toLowerCase()+'>';return j(v)}catch(e){return String(v)}}
function send(l,text){try{parent.postMessage({__lk:t,level:l,text:text},'*')}catch(e){}}
['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){send(l,Array.prototype.map.call(arguments,f).join(' '));return o.apply(console,arguments)}});
var c=console.clear;console.clear=function(){send('clear','');return c.apply(console,arguments)};
var tb=console.table;console.table=function(d){send('log',f(d));return tb.apply(console,arguments)};
var dr=console.dir;console.dir=function(d){send('log',f(d));return dr.apply(console,arguments)};
var as=console.assert;console.assert=function(ok){if(!ok)send('error','Assertion failed'+(arguments.length>1?': '+Array.prototype.slice.call(arguments,1).map(f).join(' '):''));return as.apply(console,arguments)};
addEventListener('error',function(e){send('error',(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':''))});
addEventListener('unhandledrejection',function(e){send('error','Unhandled rejection: '+f(e.reason))});})();`;
}
