#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node scripts/generate-en-catalog.cjs <keys.json>');

const outputPath = path.resolve(__dirname, '../src/shared/i18n/en.generated.json');
const keys = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const existing = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : {};
const pending = keys.filter((key) => !existing[key]);
let completed = 0;

function protectPlaceholders(value) {
  return value.replace(/\{\{(\d+)\}\}/g, '__I18N_$1__');
}

function restorePlaceholders(value) {
  return value.replace(/__I18N_(\d+)__/g, '{{$1}}');
}

async function translate(key, attempt = 0) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'zh-CN');
  url.searchParams.set('tl', 'en');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', protectPlaceholders(key));
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const translated = restorePlaceholders(payload[0].map((part) => part[0]).join(''));
    if (!translated) throw new Error('empty translation');
    return translated;
  } catch (error) {
    if (attempt >= 4) throw new Error(`Failed to translate ${JSON.stringify(key)}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    return translate(key, attempt + 1);
  }
}

async function worker() {
  while (pending.length) {
    const key = pending.shift();
    existing[key] = await translate(key);
    completed += 1;
    if (completed % 50 === 0) process.stderr.write(`Translated ${completed}/${completed + pending.length}\n`);
  }
}

Promise.all(Array.from({ length: 12 }, worker)).then(() => {
  const allKeys = [...new Set([...Object.keys(existing), ...keys])].sort();
  const ordered = Object.fromEntries(allKeys.map((key) => [key, existing[key]]));
  fs.writeFileSync(outputPath, `${JSON.stringify(ordered, null, 2)}\n`);
  process.stderr.write(`Wrote ${allKeys.length} messages to ${outputPath}\n`);
}).catch((error) => {
  fs.writeFileSync(outputPath, `${JSON.stringify(existing, null, 2)}\n`);
  console.error(error);
  process.exitCode = 1;
});
