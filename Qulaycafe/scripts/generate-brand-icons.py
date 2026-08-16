#!/usr/bin/env python3
"""Rasterise src/landing/public/logo.svg into the PNG icons the apex serves.

The marketing site shipped with the *v0 logo* as its favicon — the design tool
that generated the export left its own mark behind (icon.svg, and a black/white
icon-{light,dark}-32x32.png pair). Google shows a site's favicon next to its
search result, so "qulaycafe.uz" was advertising v0's brand, not QulayCafe's.

The sizes are Google's favicon guidance (a multiple of 48px) plus what iOS and
Android ask for:

    icon-48.png    favicon Google actually picks up
    icon-96.png    2x favicon / browser tab on a HiDPI screen
    icon-192.png   Android home screen (manifest)
    icon-512.png   Organization.logo in the JSON-LD, share previews
    apple-icon.png 180x180, iOS home screen

cairosvg is deliberately NOT a project dependency — like
scripts/optimize-landing-images.mjs, this runs by hand when the artwork
changes:

    pip install cairosvg
    python3 scripts/generate-brand-icons.py

It writes into src/landing/public/, so `npm run build:landing` copies the
result to landing/.
"""

from pathlib import Path

import cairosvg

PUBLIC = Path(__file__).resolve().parent.parent / 'src' / 'landing' / 'public'
SOURCE = PUBLIC / 'logo.svg'

# name -> pixel size (every icon is square; logo.svg is a 512x512 viewBox)
TARGETS = {
    'icon-48.png': 48,
    'icon-96.png': 96,
    'icon-192.png': 192,
    'icon-512.png': 512,
    'apple-icon.png': 180,
}


def main() -> None:
    svg = SOURCE.read_bytes()
    for name, size in TARGETS.items():
        out = PUBLIC / name
        cairosvg.svg2png(
            bytestring=svg,
            write_to=str(out),
            output_width=size,
            output_height=size,
        )
        print(f'{out.relative_to(PUBLIC.parents[2])}  {size}x{size}  {out.stat().st_size} B')


if __name__ == '__main__':
    main()
