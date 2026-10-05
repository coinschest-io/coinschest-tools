#!/usr/bin/env python3
"""Отбор словаря фразы CoinsChest из списка кандидатов.

Правила отбора:
  1. только ASCII a-z, длина 4..7
  2. без повторов
  3. ни одно слово не является началом другого
  4. первые 4 буквы уникальны (можно писать/сверять по 4 буквам)
  5. расстояние Дамерау-Левенштейна >= 2 между любой парой
     (одна опечатка не превращает слово в другое слово словаря)
"""
import sys, unicodedata

MINLEN, MAXLEN, PREFIX, TARGET = 4, 7, 4, 1024


def dl_le1(a: str, b: str) -> bool:
    """True, если расстояние Дамерау-Левенштейна между a и b <= 1."""
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if a == b:
        return True
    if la == lb:
        diff = [i for i in range(la) if a[i] != b[i]]
        if len(diff) == 1:
            return True
        if len(diff) == 2 and diff[1] == diff[0] + 1:
            i, j = diff
            return a[i] == b[j] and a[j] == b[i]  # транспозиция
        return False
    if la > lb:
        a, b, la, lb = b, a, lb, la
    i = j = 0
    skipped = False
    while i < la and j < lb:
        if a[i] == b[j]:
            i += 1
            j += 1
        elif skipped:
            return False
        else:
            skipped = True
            j += 1
    return True


def load(path):
    raw = [l.strip().lower() for l in open(path, encoding='utf-8')]
    seen, out, rejected = set(), [], {}
    for w in raw:
        if not w:
            continue
        if not w.isascii():
            rejected.setdefault('не-ASCII', []).append(w)
            continue
        if not w.isalpha():
            rejected.setdefault('не только буквы', []).append(w)
            continue
        if not (MINLEN <= len(w) <= MAXLEN):
            rejected.setdefault('длина вне 4..7', []).append(w)
            continue
        if w in seen:
            rejected.setdefault('повтор', []).append(w)
            continue
        seen.add(w)
        out.append(w)
    return out, rejected


def select(cands):
    chosen, prefixes, dropped = [], set(), []
    by_len = {}
    for w in cands:
        by_len.setdefault(len(w), []).append(w)
    for w in cands:
        p = w[:PREFIX]
        if p in prefixes:
            dropped.append((w, 'занятый префикс ' + p))
            continue
        bad = None
        for c in chosen:
            if c.startswith(w) or w.startswith(c):
                bad = f'начало/продолжение {c}'
                break
            if dl_le1(w, c):
                bad = f'отличается одной опечаткой от {c}'
                break
        if bad:
            dropped.append((w, bad))
            continue
        chosen.append(w)
        prefixes.add(p)
    return chosen, dropped


def main():
    cands, rejected = load(sys.argv[1] if len(sys.argv) > 1 else 'candidates.txt')
    chosen, dropped = select(cands)
    print(f'кандидатов принято к отбору : {len(cands)}')
    for k, v in rejected.items():
        print(f'  отсеяно на входе ({k}): {len(v)}   напр. {v[:6]}')
    print(f'прошло все правила          : {len(chosen)}')
    print(f'отброшено правилами         : {len(dropped)}')
    for w, why in dropped[:15]:
        print(f'   {w:12} — {why}')
    if len(chosen) < TARGET:
        print(f'\nНЕ ХВАТАЕТ {TARGET - len(chosen)} слов до {TARGET}')
    else:
        final = chosen[:TARGET]
        open('dictionary.txt', 'w').write('\n'.join(final) + '\n')
        print(f'\nзаписано {len(final)} слов в dictionary.txt')
        # контрольная проверка итогового файла
        assert len(set(final)) == TARGET
        assert len({w[:PREFIX] for w in final}) == TARGET
        for i in range(TARGET):
            for j in range(i + 1, TARGET):
                assert not dl_le1(final[i], final[j]), (final[i], final[j])
                assert not final[i].startswith(final[j])
                assert not final[j].startswith(final[i])
        print('контрольная проверка итогового словаря пройдена')


if __name__ == '__main__':
    main()
