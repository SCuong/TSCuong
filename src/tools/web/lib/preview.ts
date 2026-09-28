/** Builds the srcdoc for the live preview. Scripts are only included when `runScripts` is true. */
export function buildPreviewDocument(html: string, css: string, js: string, runScripts: boolean, consoleToken?: string): string {
  const style = css.trim() ? `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>` : '';
  const bridge = runScripts && consoleToken ? `<script>${consoleBridge(consoleToken)}</script>` : '';
  const script = runScripts && js.trim() ? `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>` : '';
  const head = `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${bridge}${style}`;

  if (/<html[\s>]|<!doctype/i.test(html)) {
    // A full document: inject into <head> and before </body>.
    let doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${head}`) : html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${head}</head>`);
    if (!/<html[\s>]/i.test(doc) && !/<head[^>]*>/i.test(html)) {
      doc = /<!doctype[^>]*>/i.test(doc) ? doc.replace(/<!doctype[^>]*>/i, (m) => `${m}\n${head}`) : `${head}\n${doc}`;
    }
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${script}\n</body>`) : `${doc}\n${script}`;
    return doc;
  }
  return `<!doctype html>\n<html>\n<head>\n${head}\n</head>\n<body>\n${html}\n${script}\n</body>\n</html>`;
}

/** Forwards console output and uncaught errors to the parent window, tagged with a token. */
function consoleBridge(token: string): string {
  return `(function(){var t=${JSON.stringify(token)};function f(v){try{if(typeof v==='string')return v;if(v instanceof Error)return v.name+': '+v.message;return JSON.stringify(v,null,1)}catch(e){return String(v)}}
['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){try{parent.postMessage({__lk:t,level:l,text:Array.prototype.map.call(arguments,f).join(' ')},'*')}catch(e){}return o.apply(console,arguments)}});
addEventListener('error',function(e){parent.postMessage({__lk:t,level:'error',text:(e.message||'Error')+(e.lineno?' (line '+e.lineno+')':'')},'*')});
addEventListener('unhandledrejection',function(e){parent.postMessage({__lk:t,level:'error',text:'Unhandled rejection: '+f(e.reason)},'*')});})();`;
}
