import { FormatterTool, type ParserOption } from './code/FormatterTool';

const CSS_SAMPLE = `:root{--accent:#2563eb;--radius:12px}*,*::before,*::after{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#0f172a}
.card{padding:16px 20px;border-radius:var(--radius);box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 24px -8px rgba(0,0,0,.2)}.card:hover{transform:translateY(-2px)}
@media (max-width:640px){.card{padding:12px}.grid{grid-template-columns:1fr}}@keyframes fade{from{opacity:0}to{opacity:1}}`;

const SCSS_SAMPLE = `$accent:#2563eb;@mixin focus-ring($c:$accent){outline:2px solid $c;outline-offset:2px}
.button{padding:8px 14px;border-radius:8px;background:$accent;&:hover{background:darken($accent,8%)}&:focus-visible{@include focus-ring}.icon{margin-right:6px}}
@each $name,$size in (sm:12px,md:14px,lg:16px){.text-#{$name}{font-size:$size}}`;

const LESS_SAMPLE = `@accent:#2563eb;.rounded(@r:8px){border-radius:@r}
.button{.rounded(10px);color:white;background:@accent;&:hover{background:darken(@accent,8%)}.icon{margin-right:6px}}`;

const PARSERS: ParserOption[] = [
  { value: 'css', label: 'CSS', language: 'css', ext: 'css', sample: CSS_SAMPLE },
  { value: 'scss', label: 'SCSS', language: 'css', ext: 'scss', sample: SCSS_SAMPLE },
  { value: 'less', label: 'Less', language: 'css', ext: 'less', sample: LESS_SAMPLE },
];

export default function CssFormatter() {
  return <FormatterTool toolId="css-formatter" parsers={PARSERS} fileAccept=".css,.scss,.less,text/css,text/plain" />;
}
