# Brand assets

Everything here is derived from one file. Only `medinova-logo.png` is original;
regenerate the rest rather than editing them by hand.

| File | What it is |
|---|---|
| `medinova-logo.png` | **The source.** As delivered: RGB, no alpha, black background baked in. Nothing in the application loads this — it exists so the others can be rebuilt. |
| `medinova-lockup.png` | The same lockup with a real alpha channel. This is the one to put on a page. |
| `medinova-mark.png` | The cross alone, cut at the gap before the wordmark. |
| `icon-192.png`, `icon-512.png` | PWA icons, `purpose: "any"`. The mark, transparent, inside a 92% box. |
| `maskable-192.png`, `maskable-512.png` | PWA icons, `purpose: "maskable"`. The mark on deep navy, inside the 78% safe area a launcher may crop to. |

`src/app/manifest.ts` names the four icons; nothing references the lockup or the
mark yet, because the header logo is drawn as SVG in
`src/components/brand/Logo.tsx` — vector stays crisp at every size, recolours
for a dark ground, and costs no request.

## Two things that go wrong when regenerating these

**The black background is not pure.** It carries compression speckle of 1 to 5.
Any transparency step has to treat that as background, or it survives in the
colour channels as saturated confetti — invisible in a browser, because the
alpha hides it, and glaring in anything that ignores alpha.

**Brightness must decide transparency, never colour.** Un-premultiplying — 
dividing each pixel's colour out by its own brightness — is correct at an
anti-aliased edge and wrong everywhere else, because the logo also contains
colours that are *meant* to be dark. "Medi" is `rgb(0, 35, 107)`; divided by its
own maximum it becomes `rgb(0, 83, 255)`, a bright blue that appears nowhere in
the logo. The whole mark comes back over-saturated and nobody can say why.

So: alpha from brightness, colour untouched. The threshold is taken from the
artwork rather than guessed — 60, comfortably below the darkest real colour
(107) and comfortably above the noise (8).

## Maskable is on deep navy, not brand blue

The mark's left arm is itself a mid blue. On the brand blue the two sat close
enough in value that only the white pulse line held the shape together. On the
deep navy the whole cross reads, which is what a 48-pixel home-screen icon needs.
