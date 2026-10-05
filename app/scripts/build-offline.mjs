/**
 * Сборка офлайн-файла: один HTML без единого внешнего ресурса.
 *
 * Запуск: node scripts/build-offline.mjs
 *
 * На выходе — public/downloads/coinschest-offline.html и рядом манифест с
 * отпечатком. Отпечаток печатается в инструкции и показывается на сайте: по
 * нему клиент через годы сверит скачанный откуда угодно файл с тем, который
 * выпустили мы.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/downloads');

mkdirSync(out, { recursive: true });

// Всё в один файл: iife, без внешних импортов, без карт исходников. Сборка
// идёт в stdout и нигде на диске не оседает — временный файл пришлось бы
// удалять, а лишний артефакт рядом с исходниками никому не нужен.
const script = execFileSync(
    resolve(root, 'node_modules/.bin/esbuild'),
    [
        resolve(root, 'resources/offline/app.js'),
        '--bundle',
        '--format=iife',
        '--target=es2020',
        '--legal-comments=none',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
);

if (/\b(fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(/.test(script)) {
    throw new Error('в сборке нашлось обращение к сети — офлайн-файл не должен уметь этого вовсе');
}

const built = new Date().toISOString().slice(0, 10);
const html = readFileSync(resolve(root, 'resources/offline/template.html'), 'utf8')
    .replace('__BUILD__', built)
    .replace('__SCRIPT__', () => script);

const file = resolve(out, 'coinschest-offline.html');
writeFileSync(file, html);

const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(
    resolve(out, 'offline-build.json'),
    JSON.stringify({ file: 'coinschest-offline.html', sha256: hash, built_at: built }, null, 2) + '\n'
);

console.log('файл:      public/downloads/coinschest-offline.html');
console.log('размер:    ' + (html.length / 1024).toFixed(0) + ' КБ');
console.log('sha256:    ' + hash);
console.log('в печать:  ' + hash.slice(0, 32));
