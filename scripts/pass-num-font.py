#!/usr/bin/env python3
"""
Builds public/fonts/pass-num.woff2, the narrow letters and numbers printed on passes (src/components/app/passes):
capital letters, digits, a few signs (the ? of a 样张's No.??????), the "o" of "No.", and every letter of the
characters' English names (src/data/pass-catalog.json), cut from Barlow Condensed Bold, under the SIL Open Font License 1.1
(public/fonts/pass-num-OFL.txt). Barlow has no Reserved Font Name; the copy is still named PassNum, so that a whole
Barlow Condensed on someone's computer is never mistaken for it. Run it again when a name brings a new letter:

  curl -LO https://github.com/google/fonts/raw/main/ofl/barlowcondensed/BarlowCondensed-Bold.ttf
  pip install fonttools brotli
  python3 scripts/pass-num-font.py BarlowCondensed-Bold.ttf
"""

import json
import pathlib
import string
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME = "PassNum"
FIXED = string.ascii_uppercase + string.digits + " .'-()·²&+/:#?o"


def characters() -> str:
    catalog = json.loads((ROOT / "src/data/pass-catalog.json").read_text(encoding="utf-8"))
    names = "".join((c.get("en") or "").upper() for c in catalog["characters"])
    return "".join(sorted(set(FIXED + names)))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    font = TTFont(sys.argv[1])
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga", "ccmp", "locl", "mark", "mkmk"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_languages = [0x409]
    options.hinting = False
    sub = subset.Subsetter(options)
    sub.populate(text=characters())
    sub.subset(font)
    for record in font["name"].names:
        if record.nameID in (1, 16):
            record.string = NAME
        elif record.nameID == 4:
            record.string = f"{NAME} Bold"
        elif record.nameID == 3:
            record.string = f"{NAME}-Bold"
        elif record.nameID == 6:
            record.string = f"{NAME}-Bold"
    out = ROOT / "public/fonts/pass-num.woff2"
    font.flavor = "woff2"
    font.save(out)
    print(f"{out.relative_to(ROOT)}: {len(characters())} characters, {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
