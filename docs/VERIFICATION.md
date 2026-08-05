# How OVERPOP is verified

A hundred rounds, four difficulties, eleven modes, sixteen maps, twenty-five towers
with three hundred and seventy-five upgrades. Nobody plays that by hand, so the
claim "it works" has to be backed by something other than a playtest.

This is what backs it, and — more usefully — what each layer is actually capable of
catching.

## 1. The harness runs the shipped bundle

`tools/loadgame.mjs` parses the ordered `<script src>` list out of `index.html`,
reads those exact files, and evaluates them in a Node VM behind thin browser stubs.

There is no parallel Node-only build. That has three consequences worth stating:

- Nothing can drift between "the tested code" and "the shipped code", because they
  are the same bytes.
- **Load order becomes a testable property.** With ~50 classic scripts and no module
  resolver, nothing else would check it.
- Any file that touches a live DOM API *at load time* breaks the harness — which is
  the correct signal, because it would equally break under `file://` on a cold cache.

The stubs are deliberately thin. A fat stub would let a real contract violation pass.

```sh
node tools/harness.mjs --list           # suites, and which are blocked on unbuilt files
node tools/harness.mjs --all            # every suite
node tools/harness.mjs --suite damage   # one suite
```

**A suite whose required modules are missing FAILS. It does not skip.** A vacuous
pass would let a build step be marked done on no evidence, which defeats the whole
state machine.

## 2. Determinism is the load-bearing property

Every other claim rests on it. If a seed does not reproduce, "verified across the
difficulty matrix" means nothing, because the run that was verified is not the run
anyone else gets.

`tools/suites/determinism.mjs` asserts three things, and the second is the strict one:

1. **Same seed twice** → identical checksum, compared *tick by tick* rather than only
   at the end, so the first divergent tick is named.
2. **Save mid-run, reload, continue** → identical to the run that was never
   interrupted, for 1800 further ticks. This catches any state living outside the
   save: a scratch buffer, a memo, an unserialised counter. It is how the round-set
   restoration bug was found — the checksum matched at load and diverged five ticks
   later, because a reloaded game silently fell back to a placeholder round table at
   the next round boundary.
3. **A different seed diverges**, so the test is not passing vacuously.

Plus the negative space: draining the FX queues, running the audio layer, drawing
frames, calling `Math.random` between steps, varying the frame rate, and running at
3× speed all leave the simulation bit-identical. Rendering and audio are output
only, and that is asserted rather than assumed.

`OP.Sim.checksum` folds over entity state **and the RNG state**, deliberately: two
boards that look alike but consumed different amounts of randomness are not the same
state, and would diverge on the next roll.

## 3. Content is graded against a floor it did not write

The 25 towers were authored across four files by four separate agents. The risk is
not that one of them writes a bug — it is that each writes its own idea of what
"correct" means, and its own tests to match.

So `tools/suites/_towerfamily.mjs` is the floor, written outside the fan-out. Every
family suite must call it. It checks that each tower places, fires, pops a red, is
blanked by the immunity its damage type implies, walks all six legal `5-2-0`
permutations with finite stats at every step, restats idempotently, survives a save
round-trip, and out-damages its own unupgraded self.

`tools/suites/towerfloor.mjs` then proves the floor **rejects** things, rather than
passing everything: an out-of-band upgrade cost, an undeclared projectile kind, a
borrowed proper noun, a non-idempotent `apply`, a tower that silently never fires, an
upgrade producing `NaN`, an unregistered ability key, a missing roster declaration.

A floor that passes everything is worse than no floor, because it launders bad
content as verified.

Three shared budgets stop four authors producing four games:

- **`OP.Upgrades.COST_LADDER`** — upgrade costs as multiples of the tower's own base
  cost, per tier, plus a 60–200× band for a full `5-2-0`. Without it, mispricing only
  surfaces at the balance phase, when fixing it means rewriting all four files.
- **`OP.declareProjKind()`** — tower authors emit `kind` strings and the renderer
  draws them; nothing else connects the two. The sim records every kind it actually
  emits, and the floor fails on any that was never declared. Otherwise a fraction of
  shots render as nothing.
- **`OP.FAMILY_ROSTERS`** — each family declares its own keys. Necessary because test
  fixtures register throwaway towers into the same registry, so coverage measured
  against `OP.TOWERS` would fail on fixtures.

## 4. The browser is checked separately, in a browser

The harness proves the simulation. It cannot prove the page.

`tools/smoke.mjs` boots `index.html` in headless Chrome over the DevTools protocol —
using Node's built-in WebSocket, so a project whose premise is having no dependencies
does not acquire one for its test tooling. It asserts:

- every script and asset loaded (a 404 on one of ~50 tags is otherwise silent)
- no uncaught exceptions and no console errors, at boot and after playing
- the canvas is **genuinely painted** — it samples distinct colours, because a blank
  canvas reads as exactly one
- the boot overlay was dismissed, so a cold cache is not a blank screen
- a real game plays through `OP.Test.autoplay`, the same path a player takes
- a pointer event on the canvas does not throw
- the render loop runs and median frame time is inside budget

## 5. Balance is measured, in both directions

`tools/playthroughs.mjs` plays the difficulty × mode matrix headlessly and writes
`docs/BALANCE.md` from the results.

Two builds, and the second is the one that makes it meaningful:

- a **reference build** — spend everything, spread coverage along the whole track,
  upgrade what is already covering it before widening, keep a small reserve. Not a
  clever build; the build a competent player converges on. It must hold.
- an **inadequate build** — one cheap tower, never upgraded. It must leak.

Asserting only the first would be satisfied by a game where nothing can ever leak,
which is not a tower-defense game.

The report also lists which rounds leaked across how many configurations. A round
that leaks in many configurations is a difficulty spike worth retuning; one that
leaks only in a single hard mode is working as intended. That distinction is why the
data is reported per-round rather than as a single pass/fail.

## 6. What this does not cover

Stated plainly, because a verification document that implies total coverage is worse
than one that admits its edges:

- **How it looks and feels.** A suite can prove a sprite paints, that it paints
  differently from its neighbours, and that its silhouette changes as upgrades land.
  It cannot judge whether the result is attractive or whether a balloon reads at 20px
  in motion. Only a human can.
- **Whether the balance is *fun*.** The playthroughs prove the game is winnable and
  losable. They say nothing about whether the curve is satisfying.
- **Real input.** The smoke test dispatches a synthetic pointer event and asserts it
  does not throw. It does not prove a drag feels right, or that the touch targets are
  large enough on a phone.
- **Real audio.** WebAudio is stubbed. Voice limiting, burst collapsing and event
  routing are all asserted; how it sounds is not.
- **Cross-browser.** Everything is checked in one Chromium build. Firefox and Safari
  are unverified.

## Running everything

```sh
node tools/harness.mjs --all                 # ~35 suites
node tools/smoke.mjs                         # real browser boot and play
node tools/playthroughs.mjs --rounds 100     # difficulty x mode matrix
node tools/state.mjs verify all              # do all COMPLETED build steps still pass?
```

That last one is the one that earns its keep after a pause. It re-runs the verify
command of every step already marked done, which catches work that was genuinely
finished and then broken by later work — exactly the failure a checklist of ticked
boxes hides.
