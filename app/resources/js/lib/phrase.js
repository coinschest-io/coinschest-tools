/**
 * Секретная фраза: создание и сверка.
 *
 * Правила — docs/crypto/crypto-spec-product3.md, раздел 4:
 *   — слова только из словаря (1024 слова = ровно 10 бит на слово);
 *   — 6 слов по умолчанию (60 бит), 7 — для крупных сумм;
 *   — случайность из системного генератора браузера; необязательный ввод
 *     человека («постучите по клавиатуре») подмешивается хешем и ослабить
 *     фразу не может, а подделать результат можно только подделав и то и другое;
 *   — индексы берутся маской младших 10 бит из 16-битных кусков: 65536 делится
 *     на 1024 нацело, поэтому выборка равномерна без остатка от деления.
 *
 * Модуль общий для сайта и для офлайн-файла. Ни одной сетевой функции здесь
 * нет и появиться не должно.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { WORDS } from './words.js';

export { WORDS };

export const DEFAULT_WORDS = 6;
export const STRONG_WORDS = 7;

const encoder = new TextEncoder();

function concat(...parts) {
    const size = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }

    return out;
}

function systemRandom(length) {
    const c = globalThis.crypto;
    if (!c || typeof c.getRandomValues !== 'function') {
        // Без системного генератора фразу создавать нельзя вовсе: любой
        // «запасной» источник был бы предсказуемым.
        throw new Error('браузер не даёт надёжной случайности — откройте страницу в современном браузере');
    }

    return c.getRandomValues(new Uint8Array(length));
}

/** Зерно фразы: системная случайность плюс, по желанию, ввод человека. */
export function makeSeed(extra = '') {
    return sha256(concat(systemRandom(32), encoder.encode(String(extra))));
}

/** Детерминированно: одно и то же зерно — одна и та же фраза (так проверяется). */
export function phraseFromSeed(seed, count = DEFAULT_WORDS) {
    if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error('зерно — 32 байта');
    if (count !== DEFAULT_WORDS && count !== STRONG_WORDS) throw new Error('фраза — 6 или 7 слов');

    const words = [];
    let block = null;
    let pos = 0;
    let counter = 0;

    while (words.length < count) {
        if (block === null || pos + 2 > block.length) {
            block = sha256(concat(seed, new Uint8Array([counter++])));
            pos = 0;
        }
        const index = ((block[pos] << 8) | block[pos + 1]) & 0x3ff;
        pos += 2;
        words.push(WORDS[index]);
    }

    return words.join(' ');
}

export function generatePhrase(count = DEFAULT_WORDS, extra = '') {
    return phraseFromSeed(makeSeed(extra), count);
}

/** Так фразу вводит человек: регистр, края и лишние пробелы не в счёт. */
export function cleanPhrase(text) {
    return String(text).toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Пословная сверка введённого с созданным — для подсветки под полем ввода.
 * state: ok — слово верно; bad — неверно; wait — ещё не введено.
 * hint — слово словаря, узнанное по первым четырём буквам (они уникальны).
 */
export function compareWords(expected, typed) {
    const want = cleanPhrase(expected).split(' ');
    const got = cleanPhrase(typed).split(' ').filter(Boolean);
    // Слово, которое человек ещё набирает, не ругаем раньше времени.
    const typing = !/\s$/.test(String(typed)) ? got.length - 1 : -1;

    return want.map((word, i) => {
        const mine = got[i];
        if (mine === undefined) return { state: 'wait', word: '' };
        if (mine === word) return { state: 'ok', word: mine };
        if (i === typing && word.startsWith(mine)) return { state: 'wait', word: mine };

        return { state: 'bad', word: mine, hint: recognise(mine) };
    });
}

/** Слово словаря по первым четырём буквам — или null. */
export function recognise(word) {
    const w = String(word).toLowerCase();
    if (w.length < 4) return null;

    return WORDS.find((d) => d.startsWith(w.slice(0, 4))) ?? null;
}

export function phrasesMatch(expected, typed) {
    return cleanPhrase(expected) === cleanPhrase(typed) && cleanPhrase(typed) !== '';
}

/**
 * Текст файла с фразой. В имени и содержимом нет слов, по которым ищут
 * программы-воры (bitcoin, wallet, seed, key, кошелёк, ключ) — спецификация,
 * раздел 5.
 */
export function noteText(phrase, orderNumber = '') {
    const words = cleanPhrase(phrase).split(' ');
    const lines = [
        orderNumber ? `Заметка к заказу ${orderNumber}` : 'Заметка',
        '',
        ...words.map((w, i) => `${i + 1}. ${w}`),
        '',
        'Слова пишутся латиницей, строчными, через один пробел.',
        'Перепишите их на бумагу и храните отдельно от монеты.',
        'Никому не показывайте и не пересылайте — никто, включая продавца, их не спрашивает.',
        '',
    ];

    return lines.join('\r\n');
}

export function noteFileName(orderNumber = '') {
    const safe = String(orderNumber).replace(/[^A-Za-z0-9-]/g, '');

    return safe ? `zametka-${safe}.txt` : 'zametka.txt';
}
