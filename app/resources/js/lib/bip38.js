/**
 * BIP-38, режим EC-multiply — ровно то, на чём держится монета.
 *
 * Здесь нет ничего нашего: алгоритм описан в BIP-0038 (2011) и с тех пор не
 * менялся. Файл существует, чтобы одна и та же реализация работала и на
 * странице проверки, и в офлайн-файле, который клиент скачивает и открывает
 * без интернета. Расхождение между ними означало бы, что «проверено на сайте»
 * и «проверено дома» — разные утверждения.
 *
 * Библиотеки: @noble/* — те же, что в криптоядре проекта.
 *
 * ВАЖНО: этот модуль ничего не отправляет наружу. Ни одной сетевой функции
 * здесь нет и появиться не должно.
 */
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { ecb } from '@noble/ciphers/aes.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const N = secp256k1.Point.Fn.ORDER;

// Магические байты BIP-38 для промежуточного кода.
const MAGIC_NO_LOT = '2ce9b3e1ff39e253';
const MAGIC_LOT = '2ce9b3e1ff39e251';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/* ------------------------------------------------------------------ */
/* мелочи                                                              */
/* ------------------------------------------------------------------ */

export function bytesToHex(b) {
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

function concat(...arrays) {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const a of arrays) {
        out.set(a, o);
        o += a.length;
    }
    return out;
}

function xor(a, b) {
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
    return out;
}

const sha256d = (b) => sha256(sha256(b));

function bytesToBig(b) {
    let n = 0n;
    for (const x of b) n = (n << 8n) | BigInt(x);
    return n;
}

function bigTo32(n) {
    const out = new Uint8Array(32);
    for (let i = 31; i >= 0; i--) {
        out[i] = Number(n & 0xffn);
        n >>= 8n;
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* base58check                                                         */
/* ------------------------------------------------------------------ */

export function base58Encode(bytes) {
    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let out = '';
    for (const b of bytes) {
        if (b === 0) out += ALPHABET[0];
        else break;
    }
    for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
    return out;
}

export function base58Decode(str) {
    const bytes = [0];
    for (const ch of str) {
        const value = ALPHABET.indexOf(ch);
        if (value < 0) throw new Error(`недопустимый символ «${ch}»`);
        let carry = value;
        for (let i = 0; i < bytes.length; i++) {
            carry += bytes[i] * 58;
            bytes[i] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    let zeros = 0;
    for (const ch of str) {
        if (ch === ALPHABET[0]) zeros++;
        else break;
    }
    const out = new Uint8Array(zeros + bytes.length);
    for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
    return out;
}

export function base58CheckEncode(payload) {
    return base58Encode(concat(payload, sha256d(payload).slice(0, 4)));
}

export function base58CheckDecode(str) {
    const raw = base58Decode(str);
    if (raw.length < 5) throw new Error('строка слишком короткая');
    const payload = raw.slice(0, -4);
    const checksum = raw.slice(-4);
    const expected = sha256d(payload).slice(0, 4);
    for (let i = 0; i < 4; i++) {
        if (checksum[i] !== expected[i]) throw new Error('контрольная сумма не сходится');
    }
    return payload;
}

/* ------------------------------------------------------------------ */
/* адрес и WIF                                                         */
/* ------------------------------------------------------------------ */

const hash160 = (b) => ripemd160(sha256(b));

export function addressFromPublicKey(pub) {
    return base58CheckEncode(concat(new Uint8Array([0x00]), hash160(pub)));
}

/*
 * bech32 (BIP-173), P2WPKH. На монете гравируется именно он: современные
 * кошельки после импорта ключа показывают bech32, и с legacy на монете
 * человек увидел бы «пустой» адрес. Legacy-адрес остаётся внутри BIP-38 —
 * от него считается отпечаток фразы (addresshash). Оба адреса — один ключ,
 * один hash160. Сервер строит тот же адрес: App\Support\BitcoinAddress::p2wpkh.
 */
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
    const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
        const top = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
    }
    return chk >>> 0;
}

function convertBits(data, from, to) {
    let acc = 0;
    let bits = 0;
    const out = [];
    const max = (1 << to) - 1;
    for (const v of data) {
        acc = (acc << from) | v;
        bits += from;
        while (bits >= to) {
            bits -= to;
            out.push((acc >>> bits) & max);
        }
    }
    if (bits > 0) out.push((acc << (to - bits)) & max);
    return out;
}

export function bech32Encode(hrp, data) {
    const expand = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
    const mod = bech32Polymod(expand.concat(data, [0, 0, 0, 0, 0, 0])) ^ 1;
    const checksum = [];
    for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
    return hrp + '1' + data.concat(checksum).map((d) => BECH32[d]).join('');
}

/** P2WPKH-адрес из сжатого открытого ключа; для несжатого bech32 нет — null. */
export function bech32FromPublicKey(pub) {
    if (pub.length !== 33) return null;
    return bech32Encode('bc', [0].concat(convertBits(hash160(pub), 8, 5)));
}

export function wifFromPrivateKey(key, compressed) {
    const payload = compressed
        ? concat(new Uint8Array([0x80]), key, new Uint8Array([0x01]))
        : concat(new Uint8Array([0x80]), key);
    return base58CheckEncode(payload);
}

/* ------------------------------------------------------------------ */
/* фраза                                                               */
/* ------------------------------------------------------------------ */

/**
 * Канонический вид фразы: NFC, без крайних пробелов, одиночные пробелы между
 * словами. Регистр НЕ меняется — в BIP-38 фраза чувствительна к регистру, и
 * приведение к нижнему сделало бы наш результат несовместимым со сторонними
 * программами и с официальными векторами стандарта. А совместимость здесь —
 * то, ради чего всё и сделано.
 */
export function normalizePhrase(phrase) {
    return phrase.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * Варианты фразы, которые стоит попробовать. Наши фразы состоят из строчных
 * слов словаря, а человек переписывает их от руки и вводит как получится —
 * поэтому после точного варианта пробуем ещё и приведённый к нижнему регистру.
 * Это удобство ввода, а не подбор: перебирается ровно то, что человек и так
 * набрал.
 */
function variantsOf(phrase) {
    const exact = normalizePhrase(phrase);
    const lower = exact.toLowerCase();

    return lower === exact ? [exact] : [exact, lower];
}

const phraseBytes = (phrase) => new TextEncoder().encode(phrase);

/* ------------------------------------------------------------------ */
/* EC-multiply                                                         */
/* ------------------------------------------------------------------ */

function passfactorFrom(phrase, ownerentropy, hasLotSeq) {
    const ownersalt = hasLotSeq ? ownerentropy.slice(0, 4) : ownerentropy;
    const prefactor = scrypt(phraseBytes(phrase), ownersalt, { N: 16384, r: 8, p: 8, dkLen: 32 });

    return hasLotSeq ? sha256d(concat(prefactor, ownerentropy)) : prefactor;
}

const passpointFrom = (passfactor) => secp256k1.getPublicKey(passfactor, true);

/**
 * Разбор кода заказа (промежуточного кода, «passphrase…»).
 */
// С монеты шифр переписывают группами по 5 через пробел, код заказа — как
// угодно: любые пробелы и переносы внутри строки не значат ничего.
const compact = (code) => String(code).replace(/\s+/g, '');

export function parseOrderCode(code) {
    const payload = base58CheckDecode(compact(code));
    if (payload.length !== 49) throw new Error('это не код заказа: другая длина');

    const magic = bytesToHex(payload.slice(0, 8));
    if (magic !== MAGIC_NO_LOT && magic !== MAGIC_LOT) {
        throw new Error('это не код заказа: не та метка формата');
    }

    return {
        hasLotSeq: magic === MAGIC_LOT,
        ownerentropy: payload.slice(8, 16),
        passpoint: payload.slice(16, 49),
    };
}

/**
 * Проверка карточки: та ли фраза записана рядом с этим кодом заказа.
 *
 * Считается ровно то же, что считал генератор: из фразы выводится точка на
 * кривой. Совпала с той, что зашита в коде, — значит фраза переписана верно.
 * Обратный ход невозможен: по коду фразу не восстановить.
 */
export function checkOrderCode(phrase, code) {
    const { hasLotSeq, ownerentropy, passpoint } = parseOrderCode(code);

    for (const variant of variantsOf(phrase)) {
        const mine = passpointFrom(passfactorFrom(variant, ownerentropy, hasLotSeq));
        let diff = mine.length === passpoint.length ? 0 : 1;
        for (let i = 0; i < passpoint.length; i++) diff |= mine[i] ^ passpoint[i];
        if (diff === 0) return true;
    }

    return false;
}

/**
 * Разбор кода с монеты («6P…»).
 */
export function parseEncryptedKey(code) {
    const payload = base58CheckDecode(compact(code));
    if (payload.length !== 39) throw new Error('это не код с монеты: другая длина');
    if (payload[0] !== 0x01 || payload[1] !== 0x43) {
        throw new Error('это не код с монеты: не тот формат');
    }

    const flag = payload[2];

    return {
        compressed: (flag & 0x20) !== 0,
        hasLotSeq: (flag & 0x04) !== 0,
        addresshash: payload.slice(3, 7),
        ownerentropy: payload.slice(7, 15),
        encryptedpart1: payload.slice(15, 23),
        encryptedpart2: payload.slice(23, 39),
    };
}

/**
 * Расшифровка кода с монеты фразой владельца.
 *
 * Возвращает адрес и приватный ключ. Показывать ключ или только адрес —
 * решает интерфейс: это разные по последствиям действия, и на странице они
 * разведены по разным кнопкам.
 */
export function decryptKey(phrase, code) {
    const k = parseEncryptedKey(code);

    let last = null;
    for (const variant of variantsOf(phrase)) {
        try {
            return decryptWith(variant, k);
        } catch (e) {
            last = e;
        }
    }

    throw last;
}

function decryptWith(phrase, k) {
    const passfactor = passfactorFrom(phrase, k.ownerentropy, k.hasLotSeq);
    const passpoint = passpointFrom(passfactor);

    const derived = scrypt(passpoint, concat(k.addresshash, k.ownerentropy), {
        N: 1024,
        r: 1,
        p: 1,
        dkLen: 64,
    });
    const dh1 = derived.slice(0, 32);
    const dh2 = derived.slice(32, 64);
    const aes = ecb(dh2, { disablePadding: true });

    const decrypted2 = xor(aes.decrypt(k.encryptedpart2), dh1.slice(16, 32));
    const encryptedpart1 = concat(k.encryptedpart1, decrypted2.slice(0, 8));
    const decrypted1 = xor(aes.decrypt(encryptedpart1), dh1.slice(0, 16));

    const seedb = concat(decrypted1, decrypted2.slice(8, 16));
    const factorb = sha256d(seedb);

    const priv = bigTo32((bytesToBig(passfactor) * bytesToBig(factorb)) % N);
    const pub = secp256k1.getPublicKey(priv, k.compressed);
    const address = addressFromPublicKey(pub);

    // Контроль: в коде лежит отпечаток адреса. Не сошёлся — фраза не та.
    const expected = sha256d(new TextEncoder().encode(address)).slice(0, 4);
    let diff = 0;
    for (let i = 0; i < 4; i++) diff |= expected[i] ^ k.addresshash[i];
    if (diff !== 0) throw new Error('фраза не подходит к этому коду');

    return {
        address,
        // Адрес, который выгравирован на монете (у сжатого ключа). Для
        // несжатого — null: тогда на монете legacy.
        bech32: bech32FromPublicKey(pub),
        wif: wifFromPrivateKey(priv, k.compressed),
        compressed: k.compressed,
    };
}

/* ------------------------------------------------------------------ */
/* сторона выпуска — здесь же, чтобы обе стороны считались одним кодом  */
/* ------------------------------------------------------------------ */

export function makeOrderCode(phrase, ownersalt) {
    if (ownersalt.length !== 8) throw new Error('ownersalt — восемь байт');
    const passfactor = scrypt(phraseBytes(normalizePhrase(phrase)), ownersalt, { N: 16384, r: 8, p: 8, dkLen: 32 });
    const passpoint = passpointFrom(passfactor);

    return base58CheckEncode(concat(hexToBytes(MAGIC_NO_LOT), ownersalt, passpoint));
}

export function encryptWithOrderCode(code, seedb, compressed = true) {
    if (seedb.length !== 24) throw new Error('seedb — двадцать четыре байта');

    const { ownerentropy, passpoint, hasLotSeq } = parseOrderCode(code);
    const factorb = sha256d(seedb);

    const point = secp256k1.Point.fromBytes(passpoint).multiply(bytesToBig(factorb));
    const pub = point.toBytes(compressed);
    const address = addressFromPublicKey(pub);
    const addresshash = sha256d(new TextEncoder().encode(address)).slice(0, 4);

    const derived = scrypt(passpoint, concat(addresshash, ownerentropy), {
        N: 1024,
        r: 1,
        p: 1,
        dkLen: 64,
    });
    const dh1 = derived.slice(0, 32);
    const dh2 = derived.slice(32, 64);
    // Новый экземпляр на каждое шифрование: библиотека намеренно запрещает
    // повторное использование одного и того же объекта.
    const encryptedpart1 = ecb(dh2, { disablePadding: true }).encrypt(
        xor(seedb.slice(0, 16), dh1.slice(0, 16))
    );
    const encryptedpart2 = ecb(dh2, { disablePadding: true }).encrypt(
        xor(concat(encryptedpart1.slice(8, 16), seedb.slice(16, 24)), dh1.slice(16, 32))
    );

    const flag = (compressed ? 0x20 : 0x00) | (hasLotSeq ? 0x04 : 0x00);
    const payload = concat(
        new Uint8Array([0x01, 0x43, flag]),
        addresshash,
        ownerentropy,
        encryptedpart1.slice(0, 8),
        encryptedpart2
    );

    return { address, encrypted: base58CheckEncode(payload) };
}
