# BUILD PLAN — next ~5 hours (written 2026-09-08)

Goal: finish the BTD6-look/play-alike pass. Everything below is committed and
deployed per phase (`build/overpop` → `origin/main`), never one big commit,
because OneDrive reverts.

---

## Phase 1 — Tower panel + map select polish (~60 min)

The two screens still wearing the old skin.

1. **Tower panel** (`js/ui/tower-panel.js`): selected-tower header with portrait
   + name banner, two upgrade-path cards with tier pips, chunky target/sell
   buttons, BTD6-style green BUY affordance.
2. **Map select** (`js/ui/menus.js` `buildMaps`): map cards with live
   `UI.preview` tracks on illustrated grass thumbnails, tier tabs styled as
   difficulty stars, difficulty/mode pills.
3. Verify: `node tools/harness.mjs --suite ui-game,ui-menus`, screenshot both
   screens via `node tools/visual-review.mjs --screens selected-tower,maps`.

## Phase 2 — Sprites pass: balloons + towers (~90 min)

Biggest visual lever. Currently procedural geometric shapes.

1. **Balloons** (`js/render/sprites-balloons.js`): glossy highlight ellipse,
   darker bottom shading, tied knot, MOAB-class with nose/eyes/panel lines,
   camo checker overlay, regen pulse ring.
2. **Towers** (`js/render/sprites-towers.js`): chunky silhouette + belly
   highlight, distinct head/tail per animal, tier badges (1/2/3 dots) floating
   above, throw/aim poses per family.
3. Verify: `--suite sprites-balloons,sprites-towers`, gameplay screenshot.
   Keep the portrait path in menus.js in sync — portraits use the same sprite
   functions with `reducedMotion: true` and must stay deterministic.

## Phase 3 — Parity equivalents sweep (~90 min)

Fill the "equivalent for everything" gaps (maps + achievements excluded per
user directive).

1. **Trophies + Trophy Store** (`js/core/trophies.js`): earn trophies from
   bosses/races/dailies, spend on cosmetic/flag items.
2. **Insta-critters** (`js/core/instas.js`): random tower drops from
   rounds/dailies, inventory, use-from-shop.
3. **Event calendar** (`js/data/events.js`): rotating weekly table wiring boss
   event + race + daily modifiers on dates.
4. **Monkey Teams equivalent**: weekly tower-pair modifier on standard runs
   (bonus XP/knowledge).
5. Extend knowledge 55 → ~80 nodes (fill hero/powers branches to BTD6 depth).
6. Update `docs/PARITY.md` audit table.

## Phase 4 — Gameplay feel (~45 min)

1. Round-start banner ("ROUND 42 — GOLIATH INBOUND" for boss rounds) via
   `OP.FX.say`.
2. Cash pop numbers on pops, sell poof, purchase bounce.
3. Low-lives screen edge vignette + heartbeat sfx hook.
4. Round progress: replace top-bar RBE text with a BTD6-style circular
   progress ring around the round flag.

## Phase 5 — Balance + docs + deploy (~45 min)

1. Fix fernway medium standard leak (r41 GOLIATH spike): retune Acorn Fox /
   Sap Snail mid-tier costs or reinforce `roundset-standard` r38–42 envelope.
2. Regenerate `docs/BALANCE.md`, re-run `reference-build` (target ≥92/94).
3. Full harness green → commit → `git push origin build/overpop:main`.

---

## Standing risks

- OneDrive file reverts → commit after each phase.
- Subagent spawns fail (usage limit) → all work in main context; small edits,
  verify per phase.
- Screenshot-tested sprites → keep portrait path and board sprite in sync.
- `reference-build` is the only red suite (90/94); do not regress it further
  while retuning economy.

## Definition of done

- 55 suites green (reference-build ≥92/94).
- Every BTD6 feature class (except maps/achievements) has an equivalent,
  recorded in `docs/PARITY.md` §9.
- Title, gameplay, tower panel, map select all render clean in
  `tools/visual-review.mjs` at desktop + compact viewports.
- `docs/BALANCE.md` regenerated against the final roundset.

---

# PATCH SERIES F — the five residual gaps (post-Phase-5)

Written 2026-09-08 after the phase-5 review. These are the deltas between
"the plan is done" and "the game is complete to request". Order chosen so the
small unblocking patches land first.

## Patch F1 — boss identity mapping (small, ~20 min)

The six bosses have equivalent mechanics but original identities. Keep the
mechanics; publish the mapping so equivalence is auditable.

1. `js/data/bosses.js`: display names/blurb gain a BTD6 analogue note in
   metadata (`analogue:` field), no mechanical change.
   - Cinder Toad → Bloonarius (bloom summon ≈ spawns balloons)
   - Gloom Warden → Lych (heal-drain ≈ regrow/life steal)
   - haste-sprint boss → Vortex (speed-up)
   - Ridge Colossus → Dreadbloon (armour/rock)
   - veil boss → Phayze (phase/camo)
2. `docs/PARITY.md` §9: boss table with mechanic ↔ analogue columns.
3. Verify: boss + bossevent suites (no mechanical change expected).

## Patch F2 — reference-build to 94/94 (small, ~40 min, unblocks Phase 5)

fernway medium standard leaks 153 RBE at the r41 GOLIATH spike (bot holds
13 towers / 25.7k invested, pops 1779/2040).

1. Tune TOWERS, not the roundset — the roundset is BTD6-mirrored and stays.
   Levers: Acorn Fox tier-2/3 damage/cost curve; Sap Snail support value;
   Cannon Boar price at tier 2.
2. Loop: edit → `node tools/harness.mjs --suite reference-build` → repeat.
3. If the bot still cannot hold, add ONE roundset guard assertion relaxation
   is NOT acceptable; instead deepen the bot (aura placement already exists).
4. Target: 94/94 green, then Phase 5's BALANCE.md regen is unblocked.

## Patch F3 — knowledge to ~100 nodes (medium, ~60 min)

BTD6 has ~100 nodes across 6 trees; we have 55 across 7 branches. Fill the
hero and powers branches to depth, plus the tail of each tower tree.

1. `js/data/knowledge.js`: add ~45 nodes. Per-branch targets: primary 16,
   military 16, magic 16, support 16, general 18, heroes 10, powers 10.
2. New rule hooks needed (all follow the existing `powerDurationMul` pattern):
   - `heroXpMul` — js/core/heroes.js XP award line
   - `upgradeCostMul` — js/core/economy.js upgrade pricing
   - `startRoundCashBonus` — js/core/sim.js round-end cash
   - `instaDropRate` — wired when Patch F4 lands (instas)
3. Gate + respec + save: node additions are data; schema v12 unchanged.
4. Verify: knowledge suite extended with node-count + gate assertions.

## Patch F4 — trophy store breadth + insta-critters (medium, ~90 min)

BTD6's store is ~100 cosmetics; ours will be a curated equivalent.

1. `js/data/trophies.js`: extend to ~60 items in four families:
   - trail colours/skins (render-side: fx trail colour)
   - portrait frames (shop/panel portrait ring)
   - title/flag furniture (terrain exit flag skins, title accents)
   - account badges (results screen)
2. `js/core/trophies.js`: purchase/apply/persist (schema v13: trophySpent).
3. Insta-critters: `js/core/instas.js` — drops from dailies/boss tiers/
   trophy-store crates; inventory UI in shop footer; place-for-free via
   OP.Drafts machinery (drafts already place towers free — reuse).
4. Verify: new trophy + insta suites; save migration 12→13.

## Patch F5 — Voyages: the odyssey equivalent (largest, ~120 min)

Odyssey = chain of maps, shared lives/cash, escalating restrictions.

1. `js/data/voyages.js`: 3 voyages × 5 legs; each leg is a map key +
   difficulty ramp + a restrictive mode from the existing 21 (PURIST,
   primary-only, DELUGE...). Restrictions come free via modes.
2. Implement as an Expedition campaign type: expeditions already carry
   cash/lives between stages (`applyState`/`extractState`); voyages add
   only (a) leg-mode table, (b) voyage-complete badge, (c) icons on the
   expedition select screen.
3. `js/ui/expedition.js` (screen): voyage cards with leg pills.
4. Verify: expedition suite extended; manual capture of the select screen.

## Order and checkpoints

F1 → F2 → (Phase 5 balance/docs/deploy) → F3 → F4 → F5, each committed and
deployed on landing. Final state: every residual gap closed except maps and
achievements, which are excluded by request.
