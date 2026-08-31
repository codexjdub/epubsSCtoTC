#!/usr/bin/env python3
"""Generate src/convert/ambiguity-table.js from the opencc-js dictionaries.

Why this exists: opencc-js ships STCharacters as a pre-resolved 1:1 map
(3,881 entries, one target each), so it carries no alternate-candidate data.
The ambiguity information is recoverable only by inverting TSCharacters and
grouping traditional characters by their simplified form.

Because TSCharacters lists only characters that CHANGE, a simplified form
never appears in its own preimage set: 后 inverts to {後} alone, losing the
valid 后 of 皇后. Adding identity unconditionally is NOT the fix -- it would
also offer 发 alongside 發/髮, and 发 is a simplification-only glyph that
never belongs in traditional text. Identity is gated on SHARED_GLYPHS below.

Regenerate with:  python3 tools/gen-ambiguity.py
"""
import json, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'convert', 'ambiguity-table.js')


def load(name):
    path = os.path.join(HERE, 'dicts', name)
    src = open(path, encoding='utf-8').read()
    body = src.split('"', 1)[1].rsplit('"', 1)[0]
    pairs = []
    for entry in body.split('|'):
        parts = entry.split(' ')
        if len(parts) >= 2:
            pairs.append((parts[0], parts[1:]))
    return pairs


# ---------------------------------------------------------------------------
# Simplified characters that are ALSO valid traditional characters in their
# own right, having additionally absorbed one or more distinct traditional
# forms. For these, and only these, the character itself is a legitimate
# candidate: 后 must be offerable for 皇后, 里 for 公里, 松 for 松樹.
#
# This list is CURATED, not derived. It cannot be derived from the opencc-js
# dictionaries: those list only characters that change, so a shared glyph
# (后) and a simplification-only glyph (发) are equally absent from them.
# Verified empirically -- see the note in the plan.
#
# Erring matters asymmetrically. Omitting an entry merely means the reader
# doesn't offer identity as an alternative. Adding a wrong entry would offer
# a simplified-only glyph as a choice inside a traditional book, so entries
# are included only where the traditional form is unambiguously standard.
# ---------------------------------------------------------------------------
SHARED_GLYPHS = set(
    '干'   # gan  - shield / to do;      absorbed 乾 dry, 幹 trunk
    '里'   # li   - li, village;         absorbed 裏 / 裡 inside
    '面'   # mian - face, surface;       absorbed 麵 noodle
    '只'   # zhi  - only;                absorbed 隻 classifier
    '后'   # hou  - queen, empress;      absorbed 後 after
    '松'   # song - pine;                absorbed 鬆 loose
    '板'   # ban  - board;               absorbed 闆 as in 老闆
    '谷'   # gu   - valley;              absorbed 穀 grain
    '斗'   # dou  - dipper, measure;     absorbed 鬥 to fight
    '丑'   # chou - earthly branch;      absorbed 醜 ugly
    '表'   # biao - surface, to express; absorbed 錶 wristwatch
    '系'   # xi   - lineage, system;     absorbed 係 / 繫
    '台'   # tai  - platform;            absorbed 臺 / 檯 / 颱
    '云'   # yun  - to say (classical);  absorbed 雲 cloud
    '制'   # zhi  - system, to control;  absorbed 製 to manufacture
    '志'   # zhi  - will, ambition;      absorbed 誌 to record
    '咸'   # xian - all (classical);     absorbed 鹹 salty
    '折'   # zhe  - to break;            absorbed 摺 to fold
    '卷'   # juan - scroll, volume;      absorbed 捲 to roll
    '回'   # hui  - to return;           absorbed 迴 to circulate
    '于'   # yu   - preposition, surname;absorbed 於
    '划'   # hua  - to row, paddle;      absorbed 劃 to delineate
    '佣'   # yong - commission;          absorbed 傭 servant
    '舍'   # she  - house, shed;         absorbed 捨 to relinquish
    '准'   # zhun - to permit;           absorbed 準 standard
    '借'   # jie  - to borrow;           absorbed 藉
    '姜'   # jiang- surname;             absorbed 薑 ginger
    '范'   # fan  - surname;             absorbed 範
    '余'   # yu   - I (classical);       absorbed 餘 surplus
    '几'   # ji   - small table;         absorbed 幾 how many
    '布'   # bu   - cloth;               absorbed 佈 to spread
)

ts = load('TSCharacters.js')
st = dict((s, t[0]) for s, t in load('STCharacters.js'))

inverse = defaultdict(set)
for trad, simps in ts:
    for simp in simps:
        inverse[simp].add(trad)

table = {}
for simp, preimages in inverse.items():
    candidates = set(preimages)
    if simp in SHARED_GLYPHS:
        candidates.add(simp)
    if len(candidates) < 2:
        continue
    default = st.get(simp)        # what OpenCC's character pass would pick
    ordered = []
    if default and default in candidates:
        ordered.append(default)
    for c in sorted(candidates):
        if c not in ordered:
            ordered.append(c)
    table[simp] = ordered

js = json.dumps(table, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('/* GENERATED by tools/gen-ambiguity.py -- do not edit by hand.\n')
    f.write(' *\n')
    f.write(' * Simplified characters with more than one traditional counterpart,\n')
    f.write(' * derived by inverting the opencc-js TSCharacters dictionary. The first\n')
    f.write(" * candidate is OpenCC's own character-pass default where one exists.\n")
    f.write(' *\n')
    f.write(' * Candidates are possibilities, not predictions: which one is correct in\n')
    f.write(' * a given sentence is decided by the phrase dictionary at conversion time.\n')
    f.write(' * This table exists so the reader can offer the alternatives.\n')
    f.write(' */\n')
    f.write('(function (App) {\n')
    f.write("  'use strict';\n")
    f.write('  App.ambiguityTable = ' + js + ';\n')
    f.write('})(window.App = window.App || {});\n')

print('ambiguous characters:', len(table))
print('output:', os.path.relpath(os.path.abspath(OUT), os.path.join(HERE, '..')))
for c in '发干里面复只后松板丑谷斗汇钟':
    print(' ', c, '->', ''.join(table.get(c, ['(not ambiguous)'])))
