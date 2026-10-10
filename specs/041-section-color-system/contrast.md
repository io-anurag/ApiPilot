# AP-041 contrast measurements

WCAG 2.1 ratios computed from the token values (oklab mixing for the derived `brand` steps). Thresholds:
4.5:1 text, 3:1 non-text. Surfaces: light `#FFFFFF` / `#F6F8FB`, dark `#090B10` / `#11151C` / `#181D26`.

| Check | Result |
|---|---|
| White on each section solid (primary buttons) | 5.17 (spec), 5.36, 6.29, 5.70, 6.32, 5.18, 5.47, 5.48 — all ≥ 4.5 |
| `brand-700` text on `brand-50` (light tinted panels) | 7.12 – 8.31 |
| Section accent as text on light background | 4.86 – 5.94 |
| Focus ring (`brand-500`) on white | 4.22 – 5.06 (≥ 3) |
| Dark accent as text on surface / elevated / background | 6.13 – 10.89 (all ≥ 4.5) |
| Dark accent on its own 15% tint | 4.95 – 7.54 |
| Status `-700` on `-100`, light | success 4.57 → 7.1 after darkening, warning 4.51 → 6.9, danger 5.30, info 6.21 |
| White on status `-600` buttons | success 3.30 → 5.02, warning 3.19 → 5.02 (both fixed), danger 4.83, info 5.57 |
| Dark status `-100` on `-500/15` | 12.4 – 13.0 |
| Text primary / secondary / muted, light | 17.85 / 7.12 / 5.34 (4.91 on `surface-strong`) |
| Text primary / secondary / muted, dark | 16.88 / 10.64 / 6.71 (6.03 on `surface-strong`) |
| Chart series on surface | light 4.92 – 7.58, dark 7.14 – 11.95 (≥ 3) |

Never colour alone: stage chips keep a text badge ("Complete — view", "Needs to be redone"); run results keep
their outcome label.
