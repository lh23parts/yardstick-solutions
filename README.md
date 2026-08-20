# Yardstick Solutions

Single-screen site. The poster fills the viewport on a background of its own
paper grain; clicking shoots bullet holes through the sheet to reveal sky, and
holding the mouse down fires on repeat. Contact details sit bottom-left, and an
order button bottom-right opens a Mail-style compose window for T-shirt orders.

You get six shots, counted down in the upper right. On the sixth the sheet is
crumpled up and thrown away, leaving only the sky and the line "you have ran out
of ammo — ever feel like your business is out of ammo?"

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Assets

| File | Notes |
| --- | --- |
| `yardstick.png` | The poster scan. Drawn letterboxed (`contain`) so no type is cropped. |
| `sky.jpg` | Seen through the bullet holes. |
| `bulletholes.jpg` | Green-screen reference. Keyed and segmented in-browser at load into individual hole sprites — each is a real shape from this photo, so no two holes match. |
| `paper-patch.png` | 400px square of the poster's own unprinted stock, used to tile the background. |
| `contact-phone.png`, `contact-email.png` | Phone and email, keyed off their photo to transparent ink. |
| `order-button.png` | The order button's label, set to match the printed ink. |
| `ammo-0.png` … `ammo-6.png` | Ammo counter states. |
| `out-of-ammo.png` | The out-of-ammo line, shown once the sheet is gone. |

### Derived assets

`paper-patch.png` and the two `contact-*.png` files were generated from source
photos rather than hand-drawn, so they can be regenerated if the artwork changes.

**`paper-patch.png`** — a text-free 400px square of the poster at (640, 112),
found by scanning for the region with the fewest dark pixels. Three steps matter:

1. **Despeckle.** A few dark flecks would otherwise repeat on a visible grid.
2. **Flatten.** The scan has a mild vignette (~1 lum across the patch). Tiling
   mirrors the patch, which reverses any gradient and leaves visible banding at
   each mirror axis, so a fitted quadratic surface is subtracted.
3. **Tone-match.** The patch reads ~1.5 lum brighter than the poster's mean
   paper, which would show as an edge where surround meets sheet, so it is
   shifted onto that mean.

`script.js` mirrors it into a seamless 2x2 tile at load and fills the viewport at
the poster's own scale, so grain density matches across the seam. The poster's
blank outer margin is feathered (`FEATHER`) because the vignette leaves its edge
a few lum off the flat surround, which otherwise reads as a faint line.

**`contact-*.png`** — the phone/email photo was shot on different stock under
different light (paper reads RGB ~213/71/38 vs the poster's ~235/62/12), so the
background is keyed out entirely and only the ink is kept, recoloured to the
poster's own letterpress black (RGB 30/9/7). Alpha comes from pixel darkness, so
the grain survives. The two lines are cropped and trimmed separately so they can
be set flush left, which the original photo is not.

All of these are produced by `tools/make-ink-assets.py`; run it from the repo root
to regenerate them (it is deterministic, so unchanged copy round-trips
byte-identically).

**`order-button.png`, `ammo-*.png`, `out-of-ammo.png`** — set rather than lifted from a photo,
because the artwork contains no letter "E" anywhere to compose "ORDER" from.
Impact at 88% horizontal scale matches the poster's face closely (the poster runs
~33px per character at 62px cap height; Impact runs ~39px, hence the squeeze).
Ink is the poster's black, and the letterpress breakup was tuned to the measured
statistics of `contact-email.png`'s ink — mean alpha 0.95 inside strokes, ~12%
of pixels below 0.85 — so it reads as the same printing, not a clean web font.

## The crumple

`startCrumple()` snapshots the canvas as it stands — bullet holes and all — then
warps that snapshot over a 13x17 mesh, drawing each cell as two affine-mapped
triangles. Cells are shaded by how much they compressed against their expected
area, so tight folds darken and splayed ones catch the light. The sheet gathers
toward a ball, keeps its creases, then spins off screen leaving only sky.

Two things that are easy to get wrong here: the wrinkle amount has to ramp up and
*hold* (a sine that returns to zero un-crumples the paper as it flies away), and
the source rects must key off the snapshot's own dimensions rather than the live
viewport, or resizing mid-animation skews the texture.

The hands are not implemented — see the note at the end of this file.

## Ordering

The order window builds a `mailto:` to `order@yardsticksolutions.com` with the
name, address, size, quantity and message. Note it hand-builds the query string:
`URLSearchParams` encodes spaces as `+`, which mail clients do not decode in a
mailto body (RFC 6068 wants `%20`).

**No card details are collected.** This is a static site with no backend, so
anything typed into a card field would end up in a plaintext email — unsafe for
customers and a PCI problem. The form promises a secure payment link instead. To
take payment on the site, wire up Stripe Checkout or Shopify and replace the
`mailto:` in `submitOrder()`.

## Not implemented: the hands

The crumple is procedural — a warped mesh with fold shading. The brief asked for
photorealistic hands doing the crumpling, which needs real footage or stills;
there is no such asset here and none was generated. To add them, drop in a short
clip or a PNG sequence of hands closing on a sheet (transparent background) and
composite it over the canvas on the same timeline as `crumpleFrame`, keyed to
`squeeze`. The animation deliberately leaves room for that: the sheet gathers
toward the centre, where the hands would meet.
