# fonts/*.woff2 を作り直す。
#
#   python fonts/rebuild_subset.py        (nShooter フォルダ直下で実行)
#
# ゲームは全 CJK ブロックを積むと数MBになるのでサブセットフォントを同梱しているが、
# 「今の文言で使っている文字ちょうど」に絞ると、文言をほんの少し直しただけで
# フォントから字が抜け落ちる。抜けた字だけ OS 側のフォント(Windows では中国語字形の
# 書体になることがある)で描かれるので、1つの文章の中で書体が混ざり、日本語が
# 中国語のように見える - 実際に「お・ぞ・へ・わ・ワ」の5字で起きた。
#
# そこで、収録する文字は次の和集合にしてある:
#   1. game.js / data/*.js / index.html の「文字列リテラル」に出てくる文字
#   2. ASCII + ひらがな全部 + カタカナ全部 + よく使う約物
#      (かな全部でも十数KBしか増えない。ひらがな化の文言調整で二度と事故らない)
#   3. 今 fonts/ に入っている woff2 が収録している文字(拾い漏れ対策の保険)
#
# サブセットの生成は Google Fonts の text= 機能に任せている(指定した文字だけを含む
# woff2 をその場で作って返してくれる)ので、元の TTF も fontTools も要らない。
# 実行にはネットワークが要る。brotli だけ import する(3 のために woff2 を読むため)。
import io, os, re, struct, sys, urllib.parse, urllib.request

import brotli

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "fonts")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# 絵文字は OS の絵文字フォントが描くのでサブセットから除く。
# 矢印(←↑→↓)や ★ ① は本文と同じ書体で出したいので残す
EMOJI = re.compile("[\U0001F000-\U0001FAFF️‍⬀-⯿♀-⛿]")

KNOWN_TABLES = ("cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT "
                "EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH "
                "CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar "
                "gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill").split(" ")
KNOWN_TABLES = [t for t in KNOWN_TABLES if t]


def _u128(b, i):
    v = 0
    for _ in range(5):
        c = b[i]; i += 1
        v = (v << 7) | (c & 0x7F)
        if not (c & 0x80):
            return v, i
    raise ValueError("bad UIntBase128")


def woff2_codepoints(path):
    """woff2 が収録しているコードポイントの集合。cmap は woff2 の変換対象ではないので、
    テーブルディレクトリを読んで brotli 展開後の該当範囲を切り出せばそのまま読める。"""
    d = open(path, "rb").read()
    if d[:4] != b"wOF2":
        raise ValueError("not woff2: " + path)
    num_tables = struct.unpack(">H", d[12:14])[0]
    i, tables = 48, []
    for _ in range(num_tables):
        flags = d[i]; i += 1
        idx = flags & 0x3F
        if idx == 0x3F:
            tag = d[i:i + 4].decode("latin1"); i += 4
        else:
            tag = KNOWN_TABLES[idx]
        orig_len, i = _u128(d, i)
        ver, tag = flags >> 6, tag.strip()
        # glyf/loca は ver==0 が「変換あり」、他のテーブルは ver!=0 が「変換あり」。
        # 変換ありのときだけ transformLength が続き、展開後の長さはそちらになる
        transformed = (ver == 0) if tag in ("glyf", "loca") else (ver != 0)
        length = orig_len
        if transformed:
            length, i = _u128(d, i)
        tables.append((tag, length))
    raw = brotli.decompress(d[i:])
    off, cmap = 0, None
    for tag, length in tables:
        if tag == "cmap":
            cmap = raw[off:off + length]
        off += length
    if cmap is None:
        raise ValueError("no cmap: " + path)

    cps = set()
    for k in range(struct.unpack(">H", cmap[2:4])[0]):
        _, _, sub = struct.unpack(">HHI", cmap[4 + k * 8:12 + k * 8])
        fmt = struct.unpack(">H", cmap[sub:sub + 2])[0]
        if fmt == 4:
            segx2 = struct.unpack(">H", cmap[sub + 6:sub + 8])[0]
            seg, base = segx2 // 2, sub + 14
            ends = struct.unpack(">%dH" % seg, cmap[base:base + segx2])
            starts = struct.unpack(">%dH" % seg, cmap[base + segx2 + 2:base + segx2 * 2 + 2])
            for s, e in zip(starts, ends):
                if s != 0xFFFF:
                    cps.update(range(s, e + 1))
        elif fmt == 12:
            n = struct.unpack(">I", cmap[sub + 12:sub + 16])[0]
            for g in range(n):
                s, e, _ = struct.unpack(">III", cmap[sub + 16 + g * 12:sub + 28 + g * 12])
                cps.update(range(s, e + 1))
    return cps


def js_string_chars(path):
    """行コメントを落としたうえで文字列リテラルだけを拾う(コメントの日本語は画面に出ない)"""
    lines = []
    for l in io.open(path, encoding="utf-8").read().split("\n"):
        t = l.lstrip()
        if t.startswith("//") or t.startswith("*") or t.startswith("/*"):
            continue
        lines.append(l.split("//")[0])
    out = set()
    for m in re.finditer(r'"([^"\\\n]*)"|\'([^\'\\\n]*)\'|`([^`\\]*)`', "\n".join(lines)):
        out.update(m.group(1) or m.group(2) or m.group(3) or "")
    return out


def collect_chars():
    chars = js_string_chars(os.path.join(ROOT, "game.js"))
    for f in sorted(os.listdir(os.path.join(ROOT, "data"))):
        if f.endswith(".js"):
            chars |= js_string_chars(os.path.join(ROOT, "data", f))
    html = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(r"<style.*?</style>", "", html, flags=re.S)
    chars |= set(re.sub(r"<[^>]*>", "", html))

    chars |= {chr(c) for c in range(0x20, 0x7F)}            # ASCII
    chars |= {chr(c) for c in range(0x3041, 0x3097)}        # ひらがな
    chars |= {chr(c) for c in range(0x30A1, 0x30FB)}        # カタカナ
    chars |= set("ー、。・「」『』（）〜％±×÷…‹›⁺⁻°′″√≒≠≦≧αβγδνμ☆★♪→←↑↓①②③④⑤⑥¹²³⁰⁴⁵⁶⁷⁸⁹π")

    for f in ("MPLUSRounded1c-Regular.woff2", "KosugiMaru-Regular.woff2"):
        p = os.path.join(FONTS, f)
        if os.path.exists(p):
            chars |= {chr(c) for c in woff2_codepoints(p)}

    # 全角スペースは strip() で消えるが、字送り幅のために要るので明示的に残す
    return {c for c in chars if (c.strip() or c == "　") and not EMOJI.match(c) and ord(c) < 0x10000}


JOBS = [
    ("family=M+PLUS+Rounded+1c:wght@400;700",
     {"400": "MPLUSRounded1c-Regular.woff2", "700": "MPLUSRounded1c-Bold.woff2"}),
    ("family=Kosugi+Maru", {"400": "KosugiMaru-Regular.woff2"}),
]


def main():
    text = "".join(sorted(collect_chars()))
    print("収録する文字数:", len(text))
    for fam, outmap in JOBS:
        url = "https://fonts.googleapis.com/css2?%s&text=%s" % (fam, urllib.parse.quote(text, safe=""))
        css = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read().decode()
        got = {}
        for block in re.findall(r"@font-face\s*\{(.*?)\}", css, flags=re.S):
            w = re.search(r"font-weight:\s*(\d+)", block)
            u = re.search(r"url\((https://[^)]+)\)", block)
            if w and u:
                got[w.group(1)] = u.group(1)
        for weight, fname in outmap.items():
            if weight not in got:
                sys.exit("!! %s: weight %s が返ってこなかった" % (fam, weight))
            data = urllib.request.urlopen(urllib.request.Request(got[weight], headers={"User-Agent": UA}), timeout=120).read()
            if data[:4] != b"wOF2":
                sys.exit("!! woff2 ではない: " + fname)
            dst = os.path.join(FONTS, fname)
            before = os.path.getsize(dst) if os.path.exists(dst) else 0
            io.open(dst, "wb").write(data)
            print("%-30s %6d B -> %6d B" % (fname, before, len(data)))

    # 仕上げ: 画面に出る文字がすべて収録できたか確かめる。
    # 絵文字(☢️ など)は OS の絵文字フォントが色付きで描くので対象外
    need = {c for c in collect_chars() if ord(c) > 0x7F and not EMOJI.match(c) and ord(c) != 0x2622}
    for fname in ("MPLUSRounded1c-Regular.woff2", "MPLUSRounded1c-Bold.woff2"):
        cps = woff2_codepoints(os.path.join(FONTS, fname))
        miss = "".join(sorted(c for c in need if ord(c) not in cps))
        print("%-30s 未収録: %s" % (fname, miss or "なし"))


if __name__ == "__main__":
    main()
