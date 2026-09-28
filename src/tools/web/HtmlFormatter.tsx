import { FormatterTool, type ParserOption } from './code/FormatterTool';

const HTML_SAMPLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LocalKit demo</title>
<style>body{font-family:system-ui;margin:0}.card{padding:16px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)}</style></head>
<body><main class="card"><h1>Hello <em>world</em></h1><p>This page was <strong>minified</strong> and is now readable again. <a href="/docs" target="_blank" rel="noopener">Read the docs</a>.</p>
<ul><li>Fast</li><li>Private</li><li>Offline</li></ul><button type="button" onclick="greet()">Say hi</button></main>
<script>function greet(){const name=prompt("Name?");if(name){alert("Hi "+name+"!")}}</script></body></html>`;

const VUE_SAMPLE = `<template><div class="counter"><button @click="count++">Clicked {{count}} times</button><p v-if="count>5">That's a lot!</p></div></template>
<script setup lang="ts">import {ref} from 'vue';const count=ref<number>(0)</script>
<style scoped>.counter{display:flex;gap:8px}</style>`;

const ANGULAR_SAMPLE = `<div class="list"><app-item *ngFor="let item of items; trackBy: trackById" [item]="item" (select)="onSelect($event)"></app-item><p *ngIf="!items.length">No items yet.</p></div>`;

const PARSERS: ParserOption[] = [
  { value: 'html', label: 'HTML', language: 'html', ext: 'html', sample: HTML_SAMPLE },
  { value: 'vue', label: 'Vue SFC', language: 'html', ext: 'vue', sample: VUE_SAMPLE },
  { value: 'angular', label: 'Angular template', language: 'html', ext: 'html', sample: ANGULAR_SAMPLE },
];

export default function HtmlFormatter() {
  return <FormatterTool toolId="html-formatter" parsers={PARSERS} markupOptions fileAccept=".html,.htm,.vue,.xhtml,text/html,text/plain" />;
}
