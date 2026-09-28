import { FormatterTool, type ParserOption } from './code/FormatterTool';

const JS_SAMPLE = `import {useState,useEffect} from 'react'
export default function Search({initial=''}){const [query,setQuery]=useState(initial);const [results,setResults]=useState([])
useEffect(()=>{if(!query)return;const controller=new AbortController()
fetch(\`/api/search?q=\${encodeURIComponent(query)}\`,{signal:controller.signal}).then(r=>r.json()).then(data=>setResults(data.items)).catch(()=>{})
return ()=>controller.abort()},[query])
return <div className="search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search…"/><ul>{results.map(r=><li key={r.id}>{r.title}</li>)}</ul></div>}`;

const TS_SAMPLE = `interface User{id:number;name:string;email?:string;roles:Array<'admin'|'editor'|'viewer'>}
type Result<T>={ok:true;value:T}|{ok:false;error:string}
export async function loadUser(id:number):Promise<Result<User>>{try{const res=await fetch(\`/api/users/\${id}\`);if(!res.ok)return{ok:false,error:\`HTTP \${res.status}\`};return{ok:true,value:await res.json() as User}}catch(e){return{ok:false,error:String(e)}}}
export const isAdmin=(u:User)=>u.roles.includes('admin')`;

const JSON5_SAMPLE = `{// Build settings
name:'localkit',version:'1.0.0',features:['pdf','json','images',],limits:{maxFileMB:200,workers:4,},debug:false,}`;

const JSON_SAMPLE = `{"name":"localkit","private":true,"scripts":{"dev":"vite","build":"vite build"},"dependencies":{"react":"^19.0.0"}}`;

const GRAPHQL_SAMPLE = `query GetRepo($owner:String!,$name:String!,$first:Int=10){repository(owner:$owner,name:$name){id name description stargazerCount issues(first:$first,states:OPEN){nodes{id title author{login}}}}}
fragment UserFields on User{id login avatarUrl}`;

const PARSERS: ParserOption[] = [
  { value: 'babel', label: 'JavaScript / JSX', language: 'jsx', ext: 'js', sample: JS_SAMPLE },
  { value: 'typescript', label: 'TypeScript / TSX', language: 'tsx', ext: 'ts', sample: TS_SAMPLE },
  { value: 'json', label: 'JSON', language: 'json', ext: 'json', sample: JSON_SAMPLE },
  { value: 'json5', label: 'JSON5', language: 'javascript', ext: 'json5', sample: JSON5_SAMPLE },
  { value: 'graphql', label: 'GraphQL', language: 'plain', ext: 'graphql', sample: GRAPHQL_SAMPLE },
];

export default function JsFormatter() {
  return (
    <FormatterTool
      toolId="js-formatter"
      parsers={PARSERS}
      scriptOptions
      markupOptions
      fileAccept=".js,.mjs,.cjs,.jsx,.ts,.mts,.cts,.tsx,.json,.json5,.graphql,.gql,text/javascript,application/json,text/plain"
    />
  );
}
