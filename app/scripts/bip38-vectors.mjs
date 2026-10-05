/**
 * Прогон официальных векторов BIP-0038 (EC-multiply) по нашей реализации.
 * Запуск: node scripts/bip38-vectors.mjs
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
    decryptKey,
    checkOrderCode,
    makeOrderCode,
    encryptWithOrderCode,
} from '../resources/js/lib/bip38.js';

const { vectors } = JSON.parse(readFileSync(new URL('../../docs/crypto/bip38-ec-multiply-vectors.json', import.meta.url)));

let failed = 0;
const ok = (cond, what) => {
    console.log((cond ? '  ok   ' : '  ПЛОХО') + '  ' + what);
    if (!cond) failed++;
};

console.log('Официальные векторы EC-multiply');
for (const v of vectors) {
    const r = decryptKey(v.pass, v.enc);
    ok(r.address === v.addr, `${v.name}: адрес`);
    ok(r.wif === v.wif, `${v.name}: приватный ключ`);
}

console.log('\nНеверная фраза даёт ошибку, а не другой ключ');
try {
    decryptKey('не та фраза', vectors[0].enc);
    ok(false, 'должно было выбросить ошибку');
} catch (e) {
    ok(/не подходит/.test(e.message), 'явная ошибка: ' + e.message);
}

console.log('\nНаш режим: сжатый ключ, круговой прогон');
const phrase = 'kobalt rezeda mirage tundra folio parsek';
const code = makeOrderCode(phrase, randomBytes(8));
ok(code.startsWith('passphrase'), 'код заказа начинается с passphrase');
ok(code.length >= 70 && code.length <= 74, `длина кода заказа ${code.length}`);
ok(checkOrderCode(phrase, code), 'карточка сходится с той же фразой');
ok(!checkOrderCode(phrase.replace('kobalt', 'kobolt'), code), 'опечатка в слове ломает сверку');

const { address, encrypted } = encryptWithOrderCode(code, randomBytes(24), true);
ok(encrypted.startsWith('6Pn'), `код с монеты начинается с 6Pn (${encrypted.slice(0, 3)})`);
ok(encrypted.length === 58, `длина кода с монеты ${encrypted.length}`);
const back = decryptKey(phrase, encrypted);
ok(back.address === address, 'расшифровка даёт тот же адрес');
ok(back.compressed === true, 'ключ сжатый');
ok(back.wif.startsWith('K') || back.wif.startsWith('L'), `WIF начинается с ${back.wif[0]}`);

console.log('\nПробелы и регистр во фразе не меняют результат');
ok(checkOrderCode('  ' + phrase.toUpperCase() + '  \n', code), 'нормализация фразы');

console.log('\nШифр с монеты переписан группами по 5 — читается так же');
const spaced = encrypted.match(/.{1,5}/g).join(' ').replace(/(\S{5} \S{5} \S{5} \S{5}) /g, '$1\n');
ok(decryptKey(phrase, spaced).address === address, 'группы и переносы строк не мешают');
ok(checkOrderCode(phrase, code.match(/.{1,4}/g).join(' ')), 'код заказа с пробелами тоже');

console.log(failed ? `\nОШИБОК: ${failed}` : '\nВсё сошлось');
process.exit(failed ? 1 : 0);
