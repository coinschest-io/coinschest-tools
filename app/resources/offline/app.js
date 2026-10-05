/**
 * Офлайн-файл CoinsChest: создание фразы, проверка монеты и сборка
 * приватного ключа.
 *
 * Один HTML-файл, который открывается двойным щелчком с диска и делает ровно
 * то же, что генератор в заказе и страница проверки на сайте. Смысл файла в том, что при его работе
 * никакого сайта не существует: клиент отключает интернет, и вопрос доверия к
 * нам снимается не обещанием, а отсутствием связи.
 *
 * Ограничения, которые нельзя нарушать при правке:
 *   — ноль сетевых запросов, ноль внешних ресурсов;
 *   — самопроверка на официальных векторах при каждом открытии;
 *   — приватный ключ показывается только по отдельному нажатию.
 */
import { checkOrderCode, decryptKey, makeOrderCode } from '../js/lib/bip38.js';
import { compareWords, generatePhrase, noteFileName, noteText, phrasesMatch } from '../js/lib/phrase.js';
import QRCode from 'qrcode';
import vectors from '../../../docs/crypto/bip38-ec-multiply-vectors.json' with { type: 'json' };

const $ = (id) => document.getElementById(id);

/* --- самопроверка ------------------------------------------------- */

function selfTest() {
    try {
        for (const v of vectors.vectors) {
            const r = decryptKey(v.pass, v.enc);
            if (r.address !== v.addr || r.wif !== v.wif) return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

/* --- разбор ввода -------------------------------------------------- */

const kind = (code) => {
    const c = code.trim();
    if (c.startsWith('passphrase')) return 'card';
    if (c.startsWith('6P')) return 'coin';
    return null;
};

function show(html, tone) {
    const box = $('result');
    box.className = 'result ' + (tone || '');
    box.innerHTML = html;
    box.hidden = false;
}

const escape = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

let lastKey = null;

function run() {
    const phrase = $('phrase').value;
    const code = $('code').value;
    lastKey = null;

    if (!phrase.trim() || !code.trim()) {
        show('Введите фразу и код.', 'warn');
        return;
    }

    const type = kind(code);
    if (!type) {
        show('Это не похоже ни на строку с монеты (начинается с 6P), ни на код заказа (начинается со слова passphrase).', 'warn');
        return;
    }

    show('Считаем. Это занимает несколько секунд — так и задумано: медленный расчёт мешает подбирать фразу.', '');

    // Даём браузеру перерисовать экран перед долгим счётом.
    setTimeout(() => {
        try {
            if (type === 'card') {
                const ok = checkOrderCode(phrase, code);
                show(
                    ok
                        ? '<b>Совпадает.</b> Шесть слов на карточке записаны верно.'
                        : '<b>Не совпадает.</b> Ищите опечатку: слова словаря различаются минимум двумя буквами и узнаются по первым четырём.',
                    ok ? 'ok' : 'bad'
                );
                return;
            }

            const r = decryptKey(phrase, code);
            lastKey = r.wif;
            show(
                '<b>Адрес монеты</b><code>' + escape(r.bech32 || r.address) + '</code>' +
                    (r.bech32 ? '<details><summary>Другая программа показала адрес, начинающийся с 1?</summary><p>Это тот же ключ в старом формате записи: ' + escape(r.address) + '. На монете — современный формат bc1q.</p></details>' : '') +
                    '<p>Сверьте его с выгравированным на монете — символ в символ, все до одного. Совпал — монету можно пополнять.</p>' +
                    '<button type="button" id="reveal">Показать приватный ключ</button>',
                'ok'
            );
            $('reveal').addEventListener('click', reveal);
        } catch (e) {
            show('<b>Не сходится.</b> ' + escape(e.message) + '<p>Чаще всего причина в опечатке. В коде с монеты не бывает цифры ноль, большой O, большой I и маленькой l.</p>', 'bad');
        }
    }, 50);
}

function reveal() {
    if (!lastKey) return;
    show(
        '<b>Приватный ключ</b><code>' + escape(lastKey) + '</code>' +
            '<p class="warn-text">Это ключ от ваших денег. Кто его увидит — тот заберёт средства. Переводите операцией «вывести по приватному ключу» (sweep), а не «импорт», и после этого закройте файл.</p>',
        'key'
    );
}

/* --- создать фразу ------------------------------------------------- */

let phrase = '';

const panes = ['m-intro', 'm-show', 'm-confirm', 'm-done'];
const pane = (id) => panes.forEach((p) => ($(p).hidden = p !== id));

function renderWords() {
    const list = $('m-words');
    list.textContent = '';
    phrase.split(' ').forEach((w, i) => {
        const li = document.createElement('li');
        const n = document.createElement('small');
        n.textContent = String(i + 1);
        li.append(n, document.createTextNode(w));
        list.append(li);
    });

    const sheet = $('m-sheet');
    sheet.textContent = '';
    const ol = document.createElement('ol');
    phrase.split(' ').forEach((w) => {
        const li = document.createElement('li');
        li.textContent = w;
        ol.append(li);
    });
    const tail = document.createElement('p');
    tail.textContent = 'Храните отдельно от монеты. Никому не показывайте.';
    sheet.append(ol, tail);
}

function newPhrase() {
    // Всегда шесть слов: карточка изделия рассчитана ровно на шесть.
    phrase = generatePhrase(6, $('m-extra').value);
    $('m-saved').checked = false;
    $('m-next').disabled = true;
    renderWords();
    pane('m-show');
}

function saveNote() {
    const url = URL.createObjectURL(new Blob([noteText(phrase)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = noteFileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderMarks() {
    const typed = $('m-typed').value;
    const list = $('m-marks');
    list.textContent = '';
    compareWords(phrase, typed).forEach((m, i) => {
        const li = document.createElement('li');
        li.className = m.state;
        li.textContent = `${i + 1}. ${m.word || '…'}` + (m.state === 'bad' && m.hint ? ` — похоже на «${m.hint}»` : '');
        list.append(li);
    });
    $('m-make').disabled = !phrasesMatch(phrase, typed);
}

function makeCode() {
    if (!phrasesMatch(phrase, $('m-typed').value)) return;
    pane('m-done');
    $('m-wait').hidden = false;
    $('m-result').hidden = true;

    setTimeout(() => {
        const code = makeOrderCode(phrase, crypto.getRandomValues(new Uint8Array(8)));
        phrase = '';
        $('m-typed').value = '';
        $('m-words').textContent = '';
        $('m-sheet').textContent = '';
        $('m-code').textContent = code;
        $('m-wait').hidden = true;
        $('m-result').hidden = false;
    }, 50);
}

function setupMaker(ok) {
    $('m-go').disabled = !ok;
    $('m-go').addEventListener('click', newPhrase);
    $('m-again').addEventListener('click', newPhrase);
    $('m-save').addEventListener('click', saveNote);
    $('m-print').addEventListener('click', () => window.print());
    $('m-saved').addEventListener('change', (e) => ($('m-next').disabled = !e.target.checked));
    $('m-next').addEventListener('click', () => {
        $('m-typed').value = '';
        renderMarks();
        pane('m-confirm');
        $('m-typed').focus();
    });
    $('m-back').addEventListener('click', () => pane('m-show'));
    $('m-typed').addEventListener('input', renderMarks);
    $('m-typed').addEventListener('keyup', (e) => e.key === 'Enter' && makeCode());
    $('m-make').addEventListener('click', makeCode);
    $('m-copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('m-code').textContent);
            $('m-copy').textContent = 'Скопировано';
        } catch (e) {
            // В файле, открытом с диска, буфер обмена бывает недоступен —
            // тогда код выделяется, и его можно скопировать вручную.
            const range = document.createRange();
            range.selectNodeContents($('m-code'));
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    });
}

/* --- собрать приватный ключ --------------------------------------- */

let keyWif = null;

function keyReset() {
    keyWif = null;
    $('k-addr').hidden = true;
    $('k-key').hidden = true;
    $('k-result').hidden = true;
    $('k-checked').checked = false;
    $('k-reveal').disabled = true;
    $('k-wif').textContent = '';
    $('k-qr').textContent = '';
    $('k-qr').hidden = true;
    $('k-qr-btn').hidden = false;
    $('k-copy').textContent = 'Скопировать ключ';
}

function keyMessage(html, tone) {
    const box = $('k-result');
    box.className = 'result ' + (tone || '');
    box.innerHTML = html;
    box.hidden = false;
}

function keyAssemble() {
    keyReset();
    const phrase = $('k-phrase').value;
    const code = $('k-code').value.replace(/\s+/g, '');

    if (!phrase.trim() || !code) return keyMessage('Введите фразу и строку с монеты.', 'warn');
    if (code.startsWith('passphrase')) {
        return keyMessage('Это код заказа — из него ключ не собрать. Нужна строка с плашки монеты: 58 знаков, начинается с 6P.', 'warn');
    }
    if (!code.startsWith('6P')) return keyMessage('Строка с монеты начинается с 6P — 58 знаков, выгравированы группами по 5.', 'warn');

    keyMessage('Считаем. Это занимает несколько секунд — так и задумано.', '');

    setTimeout(() => {
        try {
            const r = decryptKey(phrase, code);
            keyWif = r.wif;
            $('k-result').hidden = true;
            $('k-address').textContent = r.bech32 || r.address;
            $('k-legacy').textContent = r.bech32 ? 'Кошелёк показал адрес, начинающийся с 1? Это тот же ключ в старом формате записи: ' + r.address + '.' : '';
            $('k-addr').hidden = false;
        } catch (e) {
            keyMessage('<b>Не сходится.</b> ' + escape(e.message) + '<p>Чаще всего причина в опечатке. В строке с монеты не бывает цифры ноль, большой O, большой I и маленькой l.</p>', 'bad');
        }
    }, 50);
}

function keyReveal() {
    if (!keyWif || !$('k-checked').checked) return;
    $('k-wif').textContent = keyWif;
    $('k-kind').textContent = /^[KL]/.test(keyWif)
        ? 'Сжатый формат WIF, 52 знака, начинается с K или L.'
        : /^5/.test(keyWif)
          ? 'Несжатый формат WIF, 51 знак, начинается с 5.'
          : 'Формат WIF.';
    $('k-reveal').disabled = true;
    $('k-checked').disabled = true;
    $('k-key').hidden = false;
}

async function keyQr() {
    if (!keyWif) return;
    $('k-qr').innerHTML = await QRCode.toString(keyWif, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    $('k-qr').hidden = false;
    $('k-qr-btn').hidden = true;
}

async function keyCopy() {
    if (!keyWif) return;
    try {
        await navigator.clipboard.writeText(keyWif);
        $('k-copy').textContent = 'Скопировано';
    } catch (e) {
        const range = document.createRange();
        range.selectNodeContents($('k-wif'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

function keyWipe() {
    keyReset();
    $('k-checked').disabled = false;
    $('k-phrase').value = '';
    $('k-code').value = '';
}

function setupKey(ok) {
    $('k-go').disabled = !ok;
    $('k-go').addEventListener('click', keyAssemble);
    $('k-checked').addEventListener('change', (e) => ($('k-reveal').disabled = !e.target.checked || !keyWif));
    $('k-reveal').addEventListener('click', keyReveal);
    $('k-qr-btn').addEventListener('click', keyQr);
    $('k-copy').addEventListener('click', keyCopy);
    $('k-wipe').addEventListener('click', keyWipe);
}

function setupTabs() {
    const tabs = ['make', 'check', 'key'];
    const show = (which) => {
        tabs.forEach((t) => {
            $(t).hidden = which !== t;
            $('tab-' + t).classList.toggle('on', which === t);
        });
    };
    tabs.forEach((t) => $('tab-' + t).addEventListener('click', () => show(t)));
}

/* --- запуск -------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
    const ok = selfTest();
    const banner = $('selftest');
    banner.textContent = ok
        ? 'Самопроверка пройдена'
        : 'Самопроверка не пройдена — файлом пользоваться нельзя, скачайте его заново';
    banner.className = 'selftest ' + (ok ? 'ok' : 'bad');

    $('go').disabled = !ok;
    $('go').addEventListener('click', run);

    setupTabs();
    setupMaker(ok);
    setupKey(ok);
});
