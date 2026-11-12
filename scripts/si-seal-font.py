#!/usr/bin/env python3
"""
Builds public/fonts/si-seal.woff2: only the characters of 祀掌柜's seals (src/lib/si.ts STAMPS) and of the
words on the portraits she paints (src/components/app/SiBook.tsx), cut from Source Han Serif CN Bold, under the
SIL Open Font License 1.1 (public/fonts/si-seal-OFL.txt). A cut-down copy is a Modified Version and "Source"
is a Reserved Font Name, so the copy is named SiSeal. Run it again whenever a seal changes:

  curl -LO https://raw.githubusercontent.com/adobe-fonts/source-han-serif/release/SubsetOTF/CN/SourceHanSerifCN-Bold.otf
  pip install fonttools brotli
  python3 scripts/si-seal-font.py SourceHanSerifCN-Bold.otf
"""

import pathlib
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME = "SiSeal"
# the portraits' own words: 「…小像」, her self-portrait, the date in Chinese numerals
WORDS = "小像管理员自画像〇一二三四五六七八九十年月日"


def characters() -> str:
    si = (ROOT / "src/lib/si.ts").read_text(encoding="utf-8")
    stamps = re.search(r"export const STAMPS = \[(.*?)\]", si, re.S)
    if not stamps:
        sys.exit("STAMPS not found in src/lib/si.ts")
    text = "".join(re.findall(r'"([^"]+)"', stamps.group(1))) + WORDS
    return "".join(sorted(set(text)))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    font = TTFont(sys.argv[1])
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_languages = [0x409]
    sub = subset.Subsetter(options)
    chars = characters()
    sub.populate(text=chars)
    sub.subset(font)
    names = font["name"]
    for record in names.names:
        if record.nameID in (1, 4):
            record.string = NAME if record.nameID == 1 else f"{NAME} Bold"
        elif record.nameID == 3:
            record.string = f"{NAME}-Bold;2.003"
        elif record.nameID == 6:
            record.string = f"{NAME}-Bold"
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = [f"{NAME}-Bold"]
        top = cff.topDictIndex[0]
        top.FullName = f"{NAME} Bold"
        top.FamilyName = NAME
        if hasattr(top, "CIDFontName"):
            top.CIDFontName = f"{NAME}-Bold"
    out = ROOT / "public/fonts/si-seal.woff2"
    out.parent.mkdir(parents=True, exist_ok=True)
    font.save(out)
    print(f"{out.relative_to(ROOT)}: {len(chars)} characters, {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
