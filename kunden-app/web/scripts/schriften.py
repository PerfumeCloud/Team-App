#!/usr/bin/env python3
"""
Erzeugt die Schriften für die Club-App (src/fonts/) und auf Wunsch für das Shop-Theme.

Schrift wie in der Team-App: Inter für Text, Cormorant Garamond für Titel und große Zahlen.
Nur der Firmenname bleibt in seiner Schrift: „Perfume Cloud“ in Castoro, „PERFUME CLOUD“ in Tenor Sans.
Davon brauchen wir nur die Buchstaben, deshalb sind diese Dateien klein.

- Alle Schnitte mit ttfautohint gehintet, damit kleine Schrift unter Windows scharf ist (wie in der Team-App).
- Cormorant Garamond hat ab Werk Mediävalziffern (unterschiedlich hoch). Wir stellen die Ziffern in der Datei
  auf gerade Ziffern um, gleich hoch wie Großbuchstaben. So stimmt es überall, auch ohne CSS.

Aufruf (im Ordner kunden-app/web, nach npm ci):
  pip install fonttools brotli skia-pathops ttfautohint-py
  python3 scripts/schriften.py                      # nur Club-App
  python3 scripts/schriften.py --theme <theme-ordner>  # dazu assets/ und snippets/schriften.liquid im Theme
"""
import argparse
import io
import pathlib
import shutil

import ttfautohint
from fontTools import subset as ftsubset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
NM = ROOT / 'node_modules'
OUT = ROOT / 'src' / 'fonts'

# Zeichenbereiche wie bei @fontsource (Lateinisch inkl. Umlaute, Lateinisch erweitert)
SUBSETS = {
    'latin': 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
    'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,'
    'U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
}
INTER_WEIGHTS = (400, 500, 600)
# (Gewicht, Stil): Titel in 500, kleine Titel in 600, die Betonung kursiv in 500
CORMORANT_FACES = ((500, 'normal'), (600, 'normal'), (500, 'italic'))
# Firmenname: Buchstaben, Ziffern und die Zeichen, die in „Perfume Cloud Club“ und ähnlichen Zeilen vorkommen
MARKE_TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,-–·&’\'/'
ZIFFERN = ('zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine')


def ttf(font: TTFont) -> bytes:
    buf = io.BytesIO()
    font.flavor = None
    font.save(buf)
    return buf.getvalue()


def hinted(font: TTFont, reference: TTFont | None = None) -> TTFont:
    base = {'in_buffer': ttf(font), 'windows_compatibility': True, 'default_script': 'latn', 'fallback_script': 'latn', 'no_info': True}
    # Fehlen im Teil die Grundbuchstaben (latin-ext hat kein „o“), Maße vom latin-Teil nehmen, sonst Symbolmodus
    tries = [{}]
    if reference is not None:
        tries += [{'reference_buffer': ttf(reference)}, {'symbol': True}]
    for i, extra in enumerate(tries):
        try:
            return TTFont(io.BytesIO(ttfautohint.ttfautohint(**base, **extra)))
        except ttfautohint.TAError:
            if i == len(tries) - 1:
                raise
    raise AssertionError


def gerade_ziffern(font: TTFont) -> TTFont:
    """Ziffern auf die geraden Formen (.lf) legen. tnum macht daraus weiter die tabellarischen (.tf)."""
    namen = set(font.getGlyphOrder())
    for table in font['cmap'].tables:
        if not table.isUnicode():
            continue
        for i, n in enumerate(ZIFFERN):
            if 0x30 + i in table.cmap and f'{n}.lf' in namen:
                table.cmap[0x30 + i] = f'{n}.lf'
    return font


def marke(font: TTFont) -> TTFont:
    opts = ftsubset.Options()
    opts.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    sub = ftsubset.Subsetter(opts)
    sub.populate(text=MARKE_TEXT)
    sub.subset(font)
    return font


def write(font: TTFont, name: str) -> None:
    font.flavor = 'woff2'
    font.save(OUT / name)


def face(family: str, weight: int, style: str, url: str, subset: str | None) -> str:
    rng = f'  unicode-range: {SUBSETS[subset]};\n' if subset else ''
    return (
        f"@font-face {{\n  font-family: '{family}';\n  font-style: {style};\n  font-display: swap;\n"
        f"  font-weight: {weight};\n  src: url({url}) format('woff2');\n{rng}}}\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--theme', type=pathlib.Path, help='Theme-Ordner (mit assets/ und snippets/)')
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    for alt in OUT.glob('*.woff2'):
        alt.unlink()
    dateien: list[tuple[str, int, str, str, str | None]] = []  # (Familie, Gewicht, Stil, Datei, Teil)

    inter = lambda subset, w: instancer.instantiateVariableFont(  # noqa: E731
        TTFont(NM / '@fontsource-variable/inter/files' / f'inter-{subset}-wght-normal.woff2'), {'wght': w},
        overlap=instancer.OverlapMode.REMOVE,
    )
    for w in INTER_WEIGHTS:
        for subset in SUBSETS:
            ref = inter('latin', w) if subset != 'latin' else None
            name = f'inter-{subset}-{w}.woff2'
            write(hinted(inter(subset, w), ref), name)
            dateien.append(('Inter', w, 'normal', name, subset))

    cormorant = lambda subset, w, style: gerade_ziffern(TTFont(  # noqa: E731
        NM / '@fontsource/cormorant-garamond/files' / f'cormorant-garamond-{subset}-{w}-{style}.woff2'
    ))
    for w, style in CORMORANT_FACES:
        for subset in SUBSETS:
            ref = cormorant('latin', w, style) if subset != 'latin' else None
            name = f'cormorant-garamond-{subset}-{w}{"-italic" if style == "italic" else ""}.woff2'
            write(hinted(cormorant(subset, w, style), ref), name)
            dateien.append(('Cormorant Garamond', w, style, name, subset))

    # Firmenname: eigene Familiennamen, damit nichts anderes aus Versehen in dieser Schrift erscheint
    for src, name, family, style in (
        ('@fontsource/castoro/files/castoro-latin-400-normal.woff2', 'castoro-marke.woff2', 'Castoro Marke', 'normal'),
        ('@fontsource/castoro/files/castoro-latin-400-italic.woff2', 'castoro-marke-italic.woff2', 'Castoro Marke', 'italic'),
        ('@fontsource/tenor-sans/files/tenor-sans-latin-400-normal.woff2', 'tenor-sans-marke.woff2', 'Tenor Sans Marke', 'normal'),
    ):
        write(hinted(marke(TTFont(NM / src))), name)
        dateien.append((family, 400, style, name, None))

    kopf = '/* Erzeugt von scripts/schriften.py – nicht von Hand ändern. Gehintet für scharfe Schrift unter Windows. */\n'
    (OUT / 'fonts.css').write_text(kopf + '\n'.join(face(f, w, s, f'./{d}', t) for f, w, s, d, t in dateien))
    for f in sorted(OUT.glob('*.woff2')):
        print(f'{f.name:44} {f.stat().st_size / 1024:6.1f} KB')

    if args.theme:
        assets = args.theme / 'assets'
        for d in ('castoro.woff2', 'castoro-italic.woff2', 'tenor-sans.woff2'):
            (assets / d).unlink(missing_ok=True)
        for _, _, _, d, _ in dateien:
            shutil.copyfile(OUT / d, assets / d)
        # Vorab laden: was oben auf der Startseite sofort zu sehen ist
        vorab = ('inter-latin-400.woff2', 'inter-latin-500.woff2', 'cormorant-garamond-latin-500.woff2', 'castoro-marke.woff2', 'castoro-marke-italic.woff2')
        zeilen = [
            '{%- comment -%} Erzeugt von kunden-app/web/scripts/schriften.py – nicht von Hand ändern.',
            '  Inter für Text, Cormorant Garamond für Titel (gerade Ziffern), der Firmenname in Castoro und Tenor Sans. {%- endcomment -%}',
        ]
        zeilen += [f"{{{{ '{d}' | asset_url | preload_tag: as: 'font', type: 'font/woff2', crossorigin: 'anonymous' }}}}" for d in vorab]
        zeilen.append('<style>')
        for f, w, s, d, t in dateien:
            rng = f';unicode-range:{SUBSETS[t]}' if t else ''
            zeilen.append(
                f'@font-face{{font-family:"{f}";src:url({{{{ \'{d}\' | asset_url }}}}) format("woff2");font-weight:{w};font-style:{s};font-display:swap{rng}}}'
            )
        zeilen.append('</style>')
        (args.theme / 'snippets' / 'schriften.liquid').write_text('\n'.join(zeilen) + '\n')
        print(f'Theme: {len(dateien)} Dateien in {assets}, snippets/schriften.liquid geschrieben')


if __name__ == '__main__':
    main()
