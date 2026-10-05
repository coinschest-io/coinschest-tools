/**
 * Счёт вынесен в отдельный поток намеренно: scrypt при N=16384 занимает
 * несколько секунд, и в главном потоке страница на это время застывает —
 * человек решает, что всё сломалось, и жмёт кнопку ещё раз.
 *
 * Отправлять отсюда некуда: воркер импортирует только модуль расчёта.
 */
import { checkOrderCode, decryptKey, makeOrderCode, parseOrderCode } from './bip38.js';

self.onmessage = (event) => {
    const { id, kind, phrase, code } = event.data;

    try {
        // Код заказа из только что созданной фразы. ownersalt — восемь байт
        // системной случайности; без неё два одинаковых кода от одной фразы
        // были бы неотличимы.
        if (kind === 'make') {
            const salt = self.crypto.getRandomValues(new Uint8Array(8));
            const code = makeOrderCode(phrase, salt);
            parseOrderCode(code);
            self.postMessage({ id, ok: true, code });

            return;
        }

        if (kind === 'card') {
            self.postMessage({ id, ok: true, match: checkOrderCode(phrase, code) });

            return;
        }

        const result = decryptKey(phrase, code);
        self.postMessage({ id, ok: true, address: result.address, bech32: result.bech32, wif: result.wif });
    } catch (error) {
        self.postMessage({ id, ok: false, error: error.message });
    }
};
