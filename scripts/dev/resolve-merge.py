#!/usr/bin/env python3
"""resolve-merge.py FILE RESOLUTION_JSON
Resolve git conflict hunks in FILE deterministically (used for the parallel
area merges on 2026-10-03, where every conflict was two independent additions).
RESOLUTION_JSON: a JSON list; element i replaces conflict hunk i.
  - a string: literal replacement text (no trailing newline added)
  - "@both": HEAD then THEIRS, de-duplicating lines already in HEAD
  - "@head" / "@theirs"
"""
import sys, json, re
path, spec = sys.argv[1], json.loads(open(sys.argv[2]).read()) if sys.argv[2].endswith('.json') else json.loads(sys.argv[2])
src = open(path).read()
pat = re.compile(r'<<<<<<< [^\n]+\n(.*?)=======\n(.*?)>>>>>>> [^\n]+\n', re.S)
hunks = list(pat.finditer(src))
assert len(hunks) == len(spec), f'{path}: {len(hunks)} hunks, {len(spec)} resolutions'
out, pos = [], 0
for m, r in zip(hunks, spec):
    out.append(src[pos:m.start()])
    head, theirs = m.group(1), m.group(2)
    if r == '@both':
        hl = set(head.splitlines())
        extra = [l for l in theirs.splitlines() if l not in hl]
        txt = head + (''.join(l + '\n' for l in extra))
    elif isinstance(r, dict): txt = head + r['between'] + theirs
    elif r == '@head': txt = head
    elif r == '@theirs': txt = theirs
    else: txt = r if r.endswith('\n') else r + '\n'
    out.append(txt)
    pos = m.end()
out.append(src[pos:])
open(path, 'w').write(''.join(out))
print(f'{path}: resolved {len(hunks)} hunks')
