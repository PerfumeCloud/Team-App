#!/usr/bin/env python3
"""
Erzeugt die Schriftdateien in src/fonts/ – mit Hinting, damit kleine Schrift unter Windows scharf ist.

Die Dateien aus den @fontsource-Paketen haben kein Hinting. macOS und iOS brauchen das nicht,
Windows (Edge, Chrome) zeichnet ungehintete Schrift aber weich. Deshalb: feste Schnitte aus der
Inter-Variable-Font erzeugen und alle Schnitte mit ttfautohint hinten (wie Google Fonts für Windows).

Aufruf (im Ordner team-app/web, nach npm ci):
  pip install fonttools brotli skia-pathops ttfautohint-py
  python3 scripts/hint-fonts.py
"""
import io
import pathlib

import ttfautohint
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
INTER_WEIGHTS = (400, 500, 600, 700)
CORMORANT_WEIGHTS = (500, 600)


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


def write(font: TTFont, name: str) -> None:
    font.flavor = 'woff2'
    font.save(OUT / name)


def face(family: str, weight: int, file: str, subset: str) -> str:
    return (
        f"@font-face {{\n  font-family: '{family}';\n  font-style: normal;\n  font-display: swap;\n"
        f"  font-weight: {weight};\n  src: url(./{file}) format('woff2');\n  unicode-range: {SUBSETS[subset]};\n}}\n"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    css = ['/* Erzeugt von scripts/hint-fonts.py – nicht von Hand ändern. Gehintet für scharfe Schrift unter Windows. */\n']
    inter = lambda subset, w: instancer.instantiateVariableFont(  # noqa: E731
        TTFont(NM / '@fontsource-variable/inter/files' / f'inter-{subset}-wght-normal.woff2'), {'wght': w},
        overlap=instancer.OverlapMode.REMOVE,
    )
    cormorant = lambda subset, w: TTFont(  # noqa: E731
        NM / '@fontsource/cormorant-garamond/files' / f'cormorant-garamond-{subset}-{w}-normal.woff2'
    )
    for family, load, weights in (('Inter', inter, INTER_WEIGHTS), ('Cormorant Garamond', cormorant, CORMORANT_WEIGHTS)):
        slug = family.lower().replace(' ', '-')
        for w in weights:
            for subset in SUBSETS:
                ref = load('latin', w) if subset != 'latin' else None
                name = f'{slug}-{subset}-{w}.woff2'
                write(hinted(load(subset, w), ref), name)
                css.append(face(family, w, name, subset))
    (OUT / 'fonts.css').write_text('\n'.join(css))
    for f in sorted(OUT.glob('*.woff2')):
        print(f'{f.name:40} {f.stat().st_size / 1024:6.1f} KB')


if __name__ == '__main__':
    main()
