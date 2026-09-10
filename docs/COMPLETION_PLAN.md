# OVERPOP — Complete-game and graphics plan

Written: 2026-09-10  
Status: proposed implementation roadmap  
Scope: finish the BTD6-style browser game, including dependable saving, freeplay,
Rogue Legends, boss events, progression, and a cohesive visual presentation.

## Objective

The next milestone is a complete, dependable browser game: reliable saving,
fully playable campaigns and events, proven progression, and a cohesive
BTD6-style visual presentation.

The earlier assessment that everything had parity was too generous. The project
has substantial foundations, but several systems are simplified equivalents,
and important connections between gameplay, menus, and persistence are incomplete.
Passing 56 suites is a useful baseline; it does not prove every player-facing
journey works.

This roadmap follows a static implementation review and a wiki review. Findings
below must be reproduced and verified during implementation; this document does
not claim that the proposed changes have already been made.

## 1. Review findings

| Area | Current evidence | Work needed |
|---|---|---|
| Save and quit | Run serialization, resume, and `quitToMenu()` exist. The gameplay pause control currently just toggles pause. | Accessible pause menu, reliable autosaving, visible save status, and failure handling. |
| Legends persistence | `main.js` explicitly marks `isLegends` and mini-game context as non-serialized. Custom encounter rounds are not restored by the normal resume path. | Save and restore the actual campaign encounter, rules, modifiers, and identity. |
| Rogue Legends gameplay | A linear node campaign, artifacts, merchants, heroes, and mini-game reward logic exist. | Hearts, tower party, deployment cooldowns, campfires, extraction, and persistent Rogue XP. |
| Legends bosses | Current boss nodes generate denser balloon waves; battle configuration launches Standard mode. | Actual boss encounters with explicit victory conditions. |
| Boss Events | Weekly rotation, boss entities, normal/elite settings, and rewards exist. | Repair lifecycle ordering, enforce all five tiers, preserve event identity across reloads, and deepen mechanics. |
| Freeplay | Victory continuation and freeplay serialization exist. Generated rounds begin at 101. | Authored rounds 101–140, late-game scaling audit, and extended play/resume verification. |
| Cosmetics | Trophy purchases and equipped slots persist. | Reviewed searches found no consumers of equipped payloads in rendering/UI layers. Connect purchases to visible changes. |
| Daily login | Claim logic exists. Boot calls `OP.Save.write()`, while persistence exposes `Save.save()`. | Fix integration and add a visible calendar. |
| Powers | Ten items cover cash, lives, slowing, and damage. | Missing functional categories rather than additional variants of the same effects. |
| Co-op | Two-player local hot-seat mode. | Simultaneous online co-op needs a separate networking implementation. |
| Balance | Focused reference suite passes 94/94. | The current `BALANCE.md` reports 10/72 reference runs held. Investigate the wider matrix with mode-appropriate strategies. |
| Graphics | Canvas sprite registries, terrain caching, upgraded silhouettes, bright UI colours, and FX exist. | Consistent art direction, richer character rendering, better layout, and responsive controls. |

### Important lifecycle findings

- **Boss completion ordering:** `Rounds.complete()` can declare victory at round
  120 before `Sim.step()` reaches boss-spawn logic. Winning must require defeating
  tier five.
- **Legends encounter boundaries:** encounter tables contain roughly 12–17 rounds,
  but launch code does not establish matching encounter completion rules. These
  must end according to their own objectives.

Reproducing these findings through the browser is the first implementation task.

## 2. Definition of finished

### Scope

Retain OVERPOP's original animals and names while matching BTD6's gameplay roles,
clarity, and presentation much more closely.

Continue the user's earlier exclusions:

- No requirement to reproduce BTD6's map catalogue.
- No requirement to match BTD6's achievement count.

Existing maps still receive visual improvements and gameplay validation.

### Feature completion contract

A feature is complete only when all five conditions hold:

1. A player can find and launch it through the interface.
2. Its rules work during real gameplay.
3. It survives save, quit, browser close, and resume where permitted.
4. Completion, failure, and rewards behave correctly.
5. It has appropriate interface, graphics, audio, and regression coverage.

### Replace the existing parity checklist

Create a versioned feature ledger containing:

> Wiki reference → intended OVERPOP equivalent → implementation → UI entry point
> → persistence → verification → status

Use explicit statuses: **complete, partial, missing, deliberate difference**.

The wiki pages contain mixed-version information and some outdated sections. Pin
a release baseline and page revisions before freezing exact roster counts or
balance values. For example, the reviewed Boss Event page lists Blastapopoulos
and Diamondback; the project's old statement that BTD6 has five bosses is obsolete.

---

# Functional completion

## Phase 1 — Saving, quitting, and run ownership

**Priority: release blocker**

Primary files: `js/main.js`, `js/save.js`, `js/core/sim.js`, `js/ui/hud.js`,
`js/ui/menus.js`.

### A. Proper pause menu

- [ ] Resume.
- [ ] Save & Quit.
- [ ] Restart.
- [ ] Settings.
- [ ] Rules / encounter objectives.
- [ ] Abandon run.
- [ ] Escape cancels active placement first; otherwise it opens the pause menu.
- [ ] Save & Quit checks whether saving succeeded before discarding the live sim.

Currently `quitToMenu()` calls the save function and then discards the simulation
regardless of the result.

### B. Durable run identity

Serialize the following context for every run:

- [ ] Unique run ID and format version.
- [ ] Run type: Standard, Daily, Boss Event, Voyage, Trial, or Legends.
- [ ] Map, mode, difficulty, seed, and content revision.
- [ ] Campaign/stage/node or event identifiers.
- [ ] Encounter objective and round-set identity.
- [ ] Reward settlement state.

Result handling must use this context. An ordinary game must never advance an
unrelated active expedition or trial.

### C. Dependable persistence

- [ ] Autosave at completed-round checkpoints.
- [ ] Save campaign choices immediately.
- [ ] Explicit mid-round saving with complete encounter state.
- [ ] Page-hide/background saving as a supplementary safeguard.
- [ ] Last-known-good checkpoint.
- [ ] Visible Saved state and actionable storage-error messages.
- [ ] Export/import backup.
- [ ] Campaign/event saves protected from accidental overwriting by other runs.
- [ ] Resume paused, with saved map, round, and objective visible.

Persist and restore modifiers, cooldowns, projectiles, removables, consumed items,
campaign context, and custom rounds consistently.

### Acceptance gate

For every supported run type:

> Play → spend cash/use an ability → save → close browser → reopen → resume → finish.

The resumed simulation matches the expected state, and rewards settle exactly once.

## Phase 2 — Standard gameplay, progression, and freeplay

**Priority: release blocker**

### A. Normal player journey

Verify from a fresh profile rather than an unrestricted test configuration:

- [ ] Tutorial and first tower placement.
- [ ] Tower and hero unlocks.
- [ ] XP purchase versus in-match upgrade purchase.
- [ ] Three upgrade paths and crosspath restrictions.
- [ ] Targeting modes and manual aiming.
- [ ] Abilities, cooldowns, selling, income, and buffs.
- [ ] Land/water placement and line of sight.
- [ ] Difficulty and mode unlocks.
- [ ] Victory, defeat, restart, and permitted continues.
- [ ] Displayed prices use purchase pricing functions, including knowledge discounts.

### B. Complete freeplay

The Freeplay wiki documents authored Standard and Alternate rounds through 140.
The current generator starts at 101.

1. [ ] Complete authored 101–140 round tables.
2. [ ] Begin randomized freeplay afterward, with specified milestone rounds.
3. [ ] Audit round-81+ health scaling and Super Ceramic behaviour separately from
   the victory-continuation flag.
4. [ ] Preserve towers, income, abilities, and removables on continuation.
5. [ ] Separate victory rewards from subsequent freeplay statistics.
6. [ ] Save highest-round records.
7. [ ] Define which events and campaign encounters allow continuation.
8. [ ] Verify rounds 100, 140, 200, and an extended stress run.

**Acceptance:** a player can win, enter freeplay, quit at a later round, return,
and continue without losing progress or receiving duplicate victory rewards.

### C. Persistent progression

- [ ] Fix the daily-login persistence call.
- [ ] Add a visible calendar and reward reveal.
- [ ] Establish an account-currency economy for hero unlocks, powers, skins, and
  permitted continues.
- [ ] Clearly differentiate knowledge points, tower XP, trophies, and spendable
  currency.
- [ ] Verify rewards and consumables cannot be duplicated by reloads.

## Phase 3 — Complete Rogue Legends campaign

**Priority: major release feature**

Primary files: `js/core/legends.js`, `js/legends/legends-data.js`,
`js/legends/legends-screen.js`, plus save, shop, and lifecycle integration.

The Rogue Legends wiki describes substantially more than a sequence of ordinary
games with passive buffs.

### A. Campaign structure

- [ ] Four escalating stages.
- [ ] Navigable routes with meaningful path choices.
- [ ] Encounter previews and a revealed stage boss.
- [ ] Separate campaign hearts from in-battle lives.
- [ ] Loss, restart, skip, healing, and campaign defeat rules.
- [ ] Deterministic route generation, saved after every decision.

### B. Tower party

- [ ] Hero plus starter towers.
- [ ] Party capacity and replacement interface.
- [ ] Party-member identities, including duplicate tower types.
- [ ] Persistent pre-upgraded party members.
- [ ] Deployment cooldowns measured in rounds.
- [ ] Party-constrained shop during encounters.
- [ ] Hero progression appropriate to short encounters.

### C. Encounters and campaign economy

- [ ] Dedicated short round sets and explicit completion conditions.
- [ ] Separate encounter starting cash from merchant tokens.
- [ ] Campfires for healing, recruitment, and party upgrades.
- [ ] Merchants with visible stock, buying, selling, and rerolls.
- [ ] Chests with selectable rewards.
- [ ] Race, Endurance, Least Cash, and mini-boss objectives that alter gameplay.
- [ ] Proper knowledge/power restrictions.

### D. Artifacts and long-term progression

- [ ] Audit each artifact's actual mechanical effect.
- [ ] Distinct effects such as projectile behaviours, deployment changes, and
  tower-specific interactions.
- [ ] Rarity, selection, rerolls, stacking rules, and clear descriptions.
- [ ] Boss rewards and artifact extraction.
- [ ] Persistent Rogue XP and an upgrade shop.
- [ ] Unlockable endless/challenge campaigns and curses.

### E. Real stage bosses and robust resume

- [ ] Stage bosses use the boss system.
- [ ] Save boss state, encounter identity, artifacts, boosts, and objectives.
- [ ] Restore campaign modifiers exactly once.
- [ ] Correct boost duration accounting.
- [ ] Prevent replaying completed nodes for duplicate rewards.

### Acceptance gate

Complete an entire campaign through the browser, including a loss, healing,
merchant purchase, party upgrade, artifact extraction, and several reloads.

## Phase 4 — Complete Boss Events

**Priority: release blocker**

Primary files: `js/core/boss.js`, `js/core/bossevent.js`, `js/core/sim.js`,
`js/core/rounds.js`, `js/ui/boss-event.js`.

The Boss Event wiki makes five-tier completion, continuing rounds, and
event-specific rules central to the experience.

### A. Correct event lifecycle

- [ ] Spawn tiers at intended round boundaries.
- [ ] Continue regular rounds while the boss is active.
- [ ] Force appropriate round progression during boss fights.
- [ ] Enforce boss deadlines in rounds rather than a fixed-tick approximation.
- [ ] Require all five tiers defeated before victory.
- [ ] Keep checkpoint restart distinct from normal continue.

### B. Mechanically distinct bosses

Audit existing analogues against the pinned reference:

- [ ] Summoning and skull-triggered waves.
- [ ] Buff removal/healing and summoned entities.
- [ ] Stuns, storm shields, and speed effects.
- [ ] Rotating category immunities and rock armour.
- [ ] Camo disruption, shields, movement, and portals.
- [ ] Heat/overheat mechanics.
- [ ] Segmented bosses and vulnerable shield targets where included.

A name in an `analogue` field is not sufficient evidence of equivalent behaviour.

### C. Event framing

- [ ] Featured boss, map, restrictions, timer, rewards, and Normal/Elite selection.
- [ ] Distinct practice/Boss Challenge entry.
- [ ] Event ID and rules preserved across weekly rollover.
- [ ] Separate Normal and Elite result ledgers.
- [ ] Per-tier and full-clear rewards with replay protection.
- [ ] Appropriate paragon limits.
- [ ] Boss checkpoint resume and accurate UI wording.

### Acceptance gate

Complete a Normal and Elite event, reload during an active boss, resume across an
event rollover, and prove that round 120 alone cannot award victory.

## Phase 5 — Remaining feature categories

**Priority: required for the broad everything goal**

| Feature | Completion work |
|---|---|
| Towers, heroes, paragons | Map every reference role to a real counterpart. Verify distinctive abilities, summons, targeting, support effects, sacrifices, and paragon progression. Counts alone do not establish coverage. |
| Powers | Add utility categories: attack boosts, income boosts, time stop, traps, mines, camo removal, placement platforms/water, collectors, and ability automation. |
| Insta equivalents | Exact legal upgrade configurations, inventory browsing, placement previews, restrictions, and consumption persistence. |
| Voyages/Odyssey | Crew selection, deployment limits, difficulty variants, appropriate resource carry, resumable legs, and final rewards. |
| Races | Early-round sending, overlapping waves, scoring, retries, and consistent timing. |
| Daily challenges | Clear rules, advanced variants, completion history, and reliable reward settlement. |
| Sandbox | Balloon/property spawning, round selection, cash/lives controls, cooldown reset, damage measurements, and no progression rewards. |
| Tutorial and quests | Guided lessons for upgrading, camo/lead counters, abilities, farming, bosses, and Legends. |
| Collection events | Event currency, milestones, rewards, and expiry handling. |
| Monkey Teams / Golden Bloon equivalents | Rotating roster challenges and special reward enemies with their own rules. |
| Hero skins and cosmetics | Purchase, preview, equip, persist, and visibly render. |
| Custom challenges | Editor, validation, shareable configurations, and replay support. |

### Online-services milestone

Current hot-seat co-op does not cover simultaneous online co-op. For full
feature-category coverage, deliver a backend-supported milestone for:

- [ ] Two-to-four-player co-op, ownership, cash transfers, reconnects, and synchronization.
- [ ] Shared events and score submission.
- [ ] Leaderboards and profiles.
- [ ] Teams, Contested Territory, and Boss Rush.
- [ ] Published challenge browsing.

GitHub Pages can remain the frontend host; these services require additional
infrastructure. Give them their own completion gates rather than counting local
substitutes as full implementations.

---

# Graphics and presentation

## 3. Art direction

**Target: bright, rounded, dimensional cartoon characters on a clean, readable
battlefield.**

BTD6's appearance comes from character volume, silhouettes, lighting, animation,
and strong interface hierarchy—not just blue backgrounds and wooden panels.

### Recommended rendering approach

Use a **2.5D asset-based presentation** within the existing renderer:

- Authored or pre-rendered character sprites with directional frames.
- High-resolution portraits and upgrade icons.
- Cached illustrated terrain.
- Layered weapons and effects where useful.
- Shared asset definitions for portraits and battlefield sprites.

Existing sprite registries and terrain caching provide integration points. Keep
all animation state outside the simulation so visual quality changes cannot
affect gameplay.

## Phase G1 — Art guide and representative visual slice

Before producing the entire roster:

1. [ ] Define lighting, outline weight, shading, proportions, and material treatment.
2. [ ] Build one representative battlefield scene.
3. [ ] Include an early tower, three distinct upgrade branches, a tier-five tower,
   a hero, ordinary and modified balloons, a blimp, a boss, the shop, and the
   selected-tower panel.
4. [ ] Review at desktop and phone sizes.
5. [ ] Use the approved scene as the quality standard for subsequent assets.

This prevents another whole-game colour change that leaves the underlying art
inconsistent.

## Phase G2 — Towers, heroes, and portraits

### Character improvements

- [ ] Larger heads and readable facial features.
- [ ] Rounded bodies with top, side, and underside shading.
- [ ] Consistent soft contact shadows.
- [ ] Distinct silhouettes for every tower family.
- [ ] Clear weapon direction and projectile origin.
- [ ] Idle breathing, anticipation, recoil, and recovery animations.
- [ ] Hero-specific poses and ability animations.

### Upgrade readability

Each path needs a recognisable visual theme:

| Upgrade | Visual requirement |
|---|---|
| Tier 1–2 | Small equipment additions. |
| Tier 3 | Obvious weapon or costume change. |
| Tier 4 | Stronger silhouette and material changes. |
| Tier 5 | Unmistakable transformation. |
| Paragon | Unique design and readable degree presentation. |

Crosspaths add secondary details without hiding the main branch.

**Acceptance:** players recognise a tower's role and major upgrade investment at
normal gameplay scale without opening its panel.

## Phase G3 — Balloons, blimps, and bosses

### Balloons

- [ ] Consistent glossy highlights and rounded shading.
- [ ] Better knots and compact pop fragments.
- [ ] Clear, composable camo, regrow, and fortified treatments.
- [ ] Readable lead, ceramic, zebra, and purple identities.
- [ ] Damage-state changes for stronger shells.

### Blimps

- [ ] Dimensional hulls, panel seams, fins, and directional lighting.
- [ ] Progressive damage markings.
- [ ] Better child-release animations.
- [ ] Distinct silhouettes and colour families.

### Bosses

- [ ] Dedicated animated sprites.
- [ ] Telegraphs for attacks, shields, phases, and summons.
- [ ] Health bars with skull markers and secondary mechanics such as heat or armour.
- [ ] Short entrance and defeat sequences.
- [ ] Effects that communicate mechanics while keeping towers and controls visible.

## Phase G4 — Terrain and world depth

Improve existing maps with:

- [ ] Illustrated grass, soil, stone, and water.
- [ ] Raised track edges and consistent shadows.
- [ ] Shoreline foam and restrained water animation.
- [ ] Better trees, rocks, buildings, and removable obstacles.
- [ ] Clear entrance and exit markers.
- [ ] Distinction between decoration and placement-blocking objects.
- [ ] Subtle ambient movement.
- [ ] Consistent layering so tall props do not obscure essential information.

Terrain supports battlefield readability; decorative detail remains quieter than
active towers and balloons.

## Phase G5 — Interface hierarchy

### Home screen

Create an illustrated hub with:

- [ ] Dominant Play button.
- [ ] Prominent Continue card.
- [ ] Events, Legends, Heroes, Knowledge, and Collection destinations.
- [ ] Clearly displayed account resources.
- [ ] Sensibly grouped secondary destinations.

### Gameplay

- [ ] Compact top resource bar.
- [ ] Portrait-forward tower shop with category colours.
- [ ] Large, recognisable round-start and speed controls.
- [ ] Collapsible power tray.
- [ ] Ability buttons with cooldown rings.
- [ ] Dedicated event/objective indicators.
- [ ] Proper pause modal.
- [ ] Clear placement ghosts and range previews.

### Selected tower

- [ ] Large portrait and readable name.
- [ ] Three upgrade rows with unique icons, prices, and previews.
- [ ] Distinct unaffordable, XP-locked, and crosspath-blocked states.
- [ ] Targeting controls and consistent sell area.
- [ ] Visual explanation of what the next upgrade changes.

### Supporting screens

- [ ] Give Legends, boss events, results, knowledge, and inventories their own
  visual identity while sharing typography, buttons, spacing, and interaction rules.

## Phase G6 — Animation, audio, and cosmetics

- [ ] Button hover, press, and release states.
- [ ] Placement bounce and dust.
- [ ] Upgrade flash and short transformation animation.
- [ ] Cash collection motion and restrained reward bursts.
- [ ] Clear ability-ready feedback.
- [ ] Distinct ordinary-pop, ceramic-break, blimp-pop, and boss-defeat sounds.
- [ ] Music transitions for menus, gameplay, bosses, and Legends.
- [ ] Working equipped trails, flags, badges, titles, and skins.
- [ ] Reduced-motion, screen-shake, and effects-intensity settings.

## Phase G7 — Responsive layout and performance

The current fixed 1280×720 canvas scales down on phones. That preserves composition
but can make controls too small.

### Responsive work

- [ ] Landscape layout that protects battlefield space.
- [ ] Portrait layout with a bottom drawer for shop/upgrades.
- [ ] Approximately 44 CSS-pixel touch targets.
- [ ] Safe-area support.
- [ ] Readable text at actual device size.
- [ ] Keyboard focus and accessible labels for important controls.

### Performance work

- [ ] Sprite atlases and cached static art.
- [ ] Reusable particle pools and bounded cosmetic effects.
- [ ] Avoid per-entity gradients and expensive blur operations.
- [ ] Reduced-detail modes for late freeplay.
- [ ] Separate cosmetic particle limits from gameplay entities.
- [ ] Target 60 FPS on a representative desktop and 30 FPS on a representative
  mid-range phone, with those devices documented.
- [ ] Expand `tools/visual-review.mjs` beyond its current six screens to include
  saves, pause, results, bosses, Legends, inventories, and late-game scenes.

---

## 4. Verification and release gates

### Gate A — No progress loss

All supported modes survive save/quit/reload, and rewards settle once.

### Gate B — Complete gameplay loops

Standard victory, freeplay, a full Legends campaign, Normal/Elite boss events,
and multi-leg Voyages are playable through the UI.

### Gate C — Credible balance

Investigate the 72-run matrix with suitable strategies. A generic bot losing does
not prove a mode is impossible. Establish legal winning examples for supported
difficulties and restrictions using normal player progression.

### Gate D — Complete presentation

Every tower, upgrade family, hero, boss, collectible, and menu has finished art
and coherent interaction states.

### Gate E — Browser release

Validate Chrome, Edge, Firefox, Safari, and representative mobile browsers.
Verify the deployed site's cold load, asset loading, updates, and save compatibility.

Preserve the reported **56-suite / 12,060-assertion baseline**, adding targeted
integration coverage for newly repaired journeys.

## 5. Recommended execution order

1. Correct the parity ledger and reproduce lifecycle defects.
2. Finish save/quit and durable run identity.
3. Repair Legends encounter boundaries and boss-event victory ordering.
4. Finish standard progression and freeplay.
5. Complete Rogue Legends.
6. Complete boss mechanics, events, powers, and remaining local feature categories.
7. Develop the visual slice alongside functional work, then expand it across the game.
8. Complete responsive layouts, audio, cosmetics, and performance.
9. Deliver online services for full multiplayer/social coverage.
10. Run end-to-end release checks and deploy verified milestones.

**First implementation milestone: Save & Quit + Correct Encounter Lifecycle.**

This directly addresses the requested features and gives every subsequent
campaign, event, and graphics improvement a reliable foundation.

## 6. Wiki sources reviewed

Reviewed on 2026-09-10. Pin page revisions and the intended BTD6 release baseline
before implementing exact content counts or numerical balance.

- [Bloons TD 6](https://bloons.fandom.com/wiki/Bloons_TD_6)
  — game structure, progression, feature categories, events, and social systems.
- [Rogue Legends](https://bloons.fandom.com/wiki/Rogue_Legends)
  — campaign hearts, parties, encounters, campfires, artifacts, extraction, and Rogue XP.
- [Boss Bloon Event (BTD6)](https://bloons.fandom.com/wiki/Boss_Bloon_Event_(BTD6))
  — five-tier lifecycle, Normal/Elite variants, deadlines, checkpoints, and ranked events.
- [Freeplay Mode](https://bloons.fandom.com/wiki/Freeplay_Mode)
  — victory continuation, authored late rounds, randomized rounds, and late-game scaling.
- [Powers](https://bloons.fandom.com/wiki/Powers)
  — consumable and utility categories to compare against local implementations.
