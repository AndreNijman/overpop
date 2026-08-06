# Adversarial review — findings

The content phases fanned out across many agents. The risk that creates is not that
one of them writes a bug; it is that each writes its own idea of what correct means
and its own tests to match. So the review pass was run *against* the code by readers
who did not write it, and the shared floor
(`tools/suites/_towerfamily.mjs`, `tools/suites/towerfloor.mjs`) was written outside
the fan-out on purpose.

Every finding below is **CONFIRMED**: each was reproduced by a failing test or a
measured run before it was fixed, and each cites the commit or the file that carries
the fix. Nothing here is a suspicion. Where the correct fix turned out to be to the
*test* rather than the code, that is stated — deciding which side is wrong is the
actual work, and "fix the code, not the test" is a good default rather than a rule.

Findings are ordered by how badly they would have hurt a player.

---

## CONFIRMED · 1 · A reloaded save silently substituted a different round table

**Where:** `js/core/sim.js` — `Sim.serialize` / `Sim.deserialize` · fix in `b88c69e`
**Found by:** `tools/suites/determinism.mjs`

`deserialize` never restored the round set. The checksum matched at the moment of
load and then diverged five ticks later, at the next round boundary, because the
reloaded game fell back to a placeholder round table.

**Player impact:** every Alternate Waves save would have resumed into the wrong
waves. Silent — no error, just a different game than the one that was saved.

**Fix:** saves record the round-set *key*; `OP.ROUND_SETS` is a registry; a missing
round raises an `error` event rather than being quietly substituted.

**Why it was caught:** the determinism suite compares a save/reload against a run
that was never interrupted for 1800 *further* ticks. Comparing only at the moment of
load would have passed.

---

## CONFIRMED · 2 · Status effects were applied a tick late, and splits got a free tick

**Where:** `js/core/sim.js:145` · ARCHITECTURE.md revision 3 (§ "Effects tick before
movement, deliberately", `ARCHITECTURE.md:450`)

Effects and regen ticked *after* movement. A slow or a stun applied on tick N did not
bite until N+1, and children inheriting a freeze from a split each got one free tick
at full speed.

**Player impact:** every slow and stun in the game was marginally weaker than its
description, and worst exactly where it mattered most — a freeze landing on a
ceramic that immediately splits.

**Fix:** the tick order is now effects and regen, then movement, and this is written
into the frozen contract rather than left as an implementation detail.

---

## CONFIRMED · 3 · Aura geometry depended on tower placement order

**Where:** `js/core/towers.js:167` — `Towers.registerAuras` · fix in `855334b`

`def.buffs` ran after `restat`, so the second of two overlapping support towers
computed its own aura radius with the first one's `rangeMul` already applied. The
same two towers gave a radius of 300 or 360 depending purely on which was placed
first.

**Player impact:** identical boards behaving differently, and — because the sim must
be deterministic — a save could reload into different geometry.

**Fix:** `tower.s` is swapped to the **unbuffed** stat block inside `buffs()`, so
order-independence holds by construction rather than by every future tower author
remembering it. Recorded in ARCHITECTURE.md revision 4.

**Worth noting against myself:** my own order-independence test *missed* this. It
checked a third tower sitting comfortably inside both auras, where the difference
does not show. The assertion had to get worse-tempered before it caught anything.

---

## CONFIRMED · 4 · `Heroes.place({free: true})` bypassed one-hero-per-map

**Where:** `js/core/heroes.js` · fix in `647bdd7`
**Found by:** `tools/suites/hero-roster.mjs`

`free` was waiving the whole `canPlace` check rather than only the cost, so an
insta-placement path — or a test — could put eight heroes on one board.

**Fix:** `free` waives the **cost**, not the invariants. The hero-count check now runs
before the `free` short-circuit.

**The general shape:** a flag named for one concession quietly granting several. Worth
looking for wherever a boolean short-circuits a validator.

---

## CONFIRMED · 5 · Resuming a Reverse-mode save walked balloons out of the entrance

**Where:** `js/main.js:140` — `buildMapFor` (see also the note at `js/main.js:254`)
**Found by:** a review agent reading the resume path — not by any suite

The resume path rebuilt the *forward* map regardless of mode. For a saved Reverse
run, every stored balloon's track position `t` then referred to a track running the
other way, so the restored balloons walked back out of the entry.

**Fix:** `Maps.reversePaths` is applied before `Sim.create` on the resume path, the
same as on the fresh-start path.

**Why this one matters most as a process point:** it is the only finding here that no
test found. It needed someone to read the resume path asking "what does this assume?"
That is the argument for the review phase existing at all rather than trusting a green
suite.

---

## CONFIRMED · 6 · A save taken while a balloon was slowed reloaded it at full speed

**Where:** `js/core/balloons.js` — `speedMul` in serialize/deserialize · fix in `19381bb`
**Found by:** `tools/suites/determinism.mjs`, after the suite was strengthened

`speedMul` is derived from the effect list and recomputed each tick, but the checksum
is taken *between* ticks. Every save test written before this used towers that apply
no status effects, so no balloon was ever slowed at snapshot time — the gap was in
the fixtures, not the assertions.

**Fix:** `speedMul` is persisted. The determinism suite now saves a board with glue
and cold active and runs 600 further ticks in lockstep.

---

## CONFIRMED · 7 · Pressing an upgrade button closed the panel it was aimed at

**Where:** `js/ui/input.js:229` — `Input.tap` · fix in `19381bb`

`Input.tap` cleared the selection before firing `select`, so an on-canvas panel
button received the tap with the selection already gone. As far as the tower lookup
was concerned the press had landed on empty ground.

**Player impact:** upgrade and sell were unusable via the on-canvas panel.

**Fix:** a UI layer gets **first refusal** on a tap through a `widget` handler that
receives the live selection and returns true to claim it.

**Found by building against the API rather than reading it** — the same is true of
finding 6. Two of the seven were found only because something tried to *use* the
interface.

---

## CONFIRMED · 8 · Freeplay round N+1 could be easier than round N

**Where:** `js/data/rounds-freeplay.js` · fix in `3c93d13`

The generator varied its balloon mix with modular arithmetic (`(over % 11) * 4` and
similar). It reads well and is wrong: when a modulus wraps, the count drops by up to
40, so the curve dipped.

**Fix:** monotonicity is enforced; variety was moved into dimensions that cannot
affect difficulty ordering — release pacing and property rotation.

**Caught only because the suite asserted every consecutive pair rather than sampled
points.** For a generated difficulty curve, that distinction is the whole test.

---

## CONFIRMED · 9 · Income grew linearly against superlinear balloon HP

**Where:** `js/core/economy.js:103` — `Economy.roundBonus` · fix in `a99b5e8`
**Found by:** `tools/playthroughs.mjs` (measured, not argued)

The payout was `base + round * 2` while balloon RBE grows superlinearly, so by the
early teens a reasonable build could no longer afford to keep pace.

**Fix:** part of the payout now tracks the round's own RBE, so income cannot silently
drift out of step again when round data is retuned.

---

## CONFIRMED · 10 · The measuring instrument, four times

**Where:** `tools/playthroughs.mjs` · fixes in `a99b5e8`, `4174c6f`, `62a8ae9`, `c30f12d`

Every one of these looked exactly like a balance problem, which is what makes them
worth listing as review findings rather than tooling chores.

1. **Spots were grouped per path**, so on a multi-lane map every opening tower
   defended one lane and the rest were free from round 1. Balloons never change lane.
2. **`coverageSpots` emitted every *distance* for track position 0 before position 1**,
   so the first eight towers landed within 40 units of each other at the map entry,
   covering about a twenty-sixth of the track. Every balance number taken before this
   fix was of a board piled up at the entrance.
3. **The opening bought cheapest-first across the whole roster**, spending the starting
   cash on a slower, a short-range spiker and a hazard-layer before anything that
   deals damage.
4. **The bot never held a reserve.** It spent every dollar on the next cheap tier-1/2
   upgrade, so cash never reached the price of the first explosive tower: 4835 earned
   by round 24, never more than ~120 in hand, board still carrying only `sharp` and
   `acid`. It then met Lead — which no sharp tower can pop — and died. The first
   attempt at a fix was itself wrong in an instructive way: saving for "a type the
   board lacks" is unbounded, so the board reached five of six types and then sat on
   417 unspent forever waiting on a `normal` attacker it did not need, with every
   tower stalled at tier 0-1. The hold is now bound to `unanswerableTiers()` — a tier
   that is actually arriving and that the board actually cannot damage — which is the
   same expression the loss explainer prints, so the reason to save and the evidence
   of needing to save cannot drift apart.

`--explain` was added because of this class of fault: it prints the roster, its damage
types, unspent cash and any tier the board has no answer to, so a loss can be told
apart from an immunity gap without guessing.

**The transferable lesson: when an auto-played matrix says the game is too hard,
suspect the instrument before the content.** Check whether difficulty ordering
survives — if easy holds and hard does not, the curve is probably fine. Here easy and
medium failed at the *identical* round in every mode, which is not what a
cash-or-lives shortfall looks like, and that anomaly is what exposed fault 4.

---

## CONFIRMED · 11 · Assertions that only passed while the project was unfinished

Reported as a class because it recurred, and because a test like this is worse than
no test: it goes green for the wrong reason and then breaks when the code improves.
Each of these was fixed on the **test** side.

- A render assertion demanded an `arc` call specifically; another relied on a tier
  having *no* sprite. Both would fail the moment real art landed. Now they assert
  that painting happened, not how (`b593b00`).
- A name-only draw signature is blind to a sprite flipping to face its target — the
  call sequence is identical and only the coordinates change. Signatures now capture
  arguments, which would also catch a sprite drawing in the wrong place.
- Sprite coverage was measured against `OP.TOWERS`, which includes throwaway towers
  registered by other suites, so it failed on fixtures under `--all`. Now measured
  against `OP.FAMILY_ROSTERS` and a scan of the shipped sources.
- A smoke assertion required the canvas attribute to equal 1280×720, but
  `Camera.resize` sizes the backing store to the viewport; 1280×720 is the *logical*
  design space.
- A HUD test wanted `lives: 2` flagged critical while the code used a purely
  proportional rule — so a Relentless run (1 life) never warned while 2 of 200 did.
  This one was fixed in the **code**: proportional OR absolute (`<= 5`).
- A reviewer's upgrade-description rule demanded 3+ words and 40+ characters, which
  rejected `"+30 range."` — ideal panel text. Padding descriptions to satisfy a length
  rule would have made the game worse. The bar is now "names a number or a mechanic,
  and is not a placeholder".

---

## What the review did not settle

**Whether a human-quality build clears rounds 40–100 on the expert maps.** The
reference bot holds 5 of 72 configurations. After the four instrument fixes above the
board is *correct* — it covers the damage types and can pop Lead — but its upgrades
stay shallow, because round-robin spreading never accumulates enough for a tier-4 or
tier-5. Fixing that means building a bot that plays like a competent human, which
would prove something about the bot.

So `P9.2` / `P9.2b` are recorded as **forced** in `docs/BUILD_LOG.md` rather than
quietly marked green, and the round curve was deliberately **not** retuned to make a
weak bot survive — that would make the real game trivial for a real player. This
needs hands on it.

The measured facts that *are* established, all from real headless runs:

1. **The geometry is fair.** Given resources, the three hardest maps — including the
   two designed to be nasty — hold to round 40 with **zero leaks**. No map is
   unwinnable by construction.
2. **The early curve is survivable with a modest board.** Eight of the cheapest
   attacker, spread along the track and upgraded round-robin, take **no leaks at all
   through round 16**.
3. **The type chart bites exactly where designed.** That same sharp-only board's first
   leak is **round 20** — the round Lead first appears, which no sharp tower can pop.
   It dies at 30. That is the immunity system working, not a balance fault.
