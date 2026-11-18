/**
 * Сборка офлайн-файла: один HTML без единого внешнего ресурса.
 *
 * Запуск: node scripts/build-offline.mjs
 *
 * На выходе — public/downloads/coinschest-offline.html и рядом манифест с
 * отпечатком. Отпечаток печатается в инструкции и показывается на сайте: по
 * нему клиент через годы сверит скачанный откуда угодно файл с тем, который
 * выпустили мы.
 *
 * Новый выпуск: поправить код → в resources/offline/release.json поднять
 * version и date, sha256 стереть → собрать → вписать напечатанный sha256 в
 * release.json → закоммитить и поставить тег vX.Y.Z (релиз соберётся сам).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/downloads');

mkdirSync(out, { recursive: true });

// Всё в один файл: iife, без внешних импортов, без карт исходников. Сборка
// идёт в stdout и нигде на диске не оседает — временный файл пришлось бы
// удалять, а лишний артефакт рядом с исходниками никому не нужен.
const esbuildCandidates = [process.arch, ...(process.platform === 'darwin' ? ['arm64', 'x64'] : [])]
    .map((arch) => resolve(
        root,
        `node_modules/@esbuild/${process.platform}-${arch}/bin/esbuild${process.platform === 'win32' ? '.exe' : ''}`
    ));
const esbuild = esbuildCandidates.find((candidate) => existsSync(candidate)) ?? resolve(root, 'node_modules/.bin/esbuild');
const script = execFileSync(
    esbuild,
    [
        resolve(root, 'resources/offline/app.js'),
        '--bundle',
        '--format=iife',
        '--target=es2020',
        '--legal-comments=none',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: root }
);

if (/\b(fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(/.test(script)) {
    throw new Error('в сборке нашлось обращение к сети — офлайн-файл не должен уметь этого вовсе');
}

// Дата выпуска и его эталонный отпечаток берутся из файла в репозитории, а не
// из часов. С датой «сегодня» файл, собранный в любой другой день, получал бы
// другой sha256, и обещание «соберите сами — отпечаток совпадёт» не
// выполнялось бы ни у кого, кроме нас в день выпуска.
const release = JSON.parse(readFileSync(resolve(root, 'resources/offline/release.json'), 'utf8'));
const built = release.date;
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

if (release.sha256) {
    if (hash === release.sha256) {
        console.log('сверка:    совпадает с опубликованным отпечатком выпуска ' + release.version);
    } else {
        console.log('сверка:    НЕ совпадает с отпечатком выпуска ' + release.version + ' (' + release.sha256.slice(0, 16) + '…)');
        console.log('           Ставили зависимости через npm ci? Меняли код — обновите resources/offline/release.json.');
        process.exitCode = 1;
    }
}
