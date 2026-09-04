# Mechanics & feature parity — OVERPOP vs Bloons TD 6

How OVERPOP (the work-in-progress branch in this repo) lines up against the
canonical Bloons TD 6 game and the **Rogue Legends** expansion, as a mechanics
and feature checklist rather than a balance audit.

- **Method:** (1) headless playthrough of the shipped bundle across the
  difficulty/mode matrix (`node tools/playthroughs.mjs`), (2) local inventory
  read straight out of the data files, (3) cross-reference against the official
  BTD6 wiki (Blooncyclopedia + Fandom) and the Rogue Legends wiki.
- **Date:** 2026-09-04. Commit `2bcc814`.
- **Legend:** `✓` direct parity · `~` present but renamed/original-name spin ·
  `–` absent · `Δ` divergence worth a decision.

Legend status is about *does the mechanic exist and behave like canon*, not
whether numbers match. Names are often deliberately original because the project
keeps a "no borrowed proper nouns" rule for Bloons-specific words (MOAB, Monkeys,
etc.), so a renamed mechanic still counts as parity.

## 1. Difficulties — `✓` near-exact mirror

Overpop keeps BTD6's difficulty DNA almost 1:1.

| tier | rounds | lives | rack note |
|---|---|---:|---|
| Easy | 40 | 200 | ✓ (BTD6 Easy 1–40, 200) |
| Medium | 60 | 150 | ✓ (BTD6 Medium 1–60, 150) |
| Hard | 80 | 100 | ✓ (BTD6 Hard 3–80, 100) |
| Relentless | 100 | 1 | ~ BTD6 "Unimpoppable" (6–100, 1 life) |

Cost multipliers tilt up with difficulty (0.85 / 1 / 1.08 / 1.2) and pop payout
tilts down, mirroring canon. BTD6's **Impoppable** is expressed here as the
**Relentless** difficulty; there is no separate Impoppable *mode*.

## 2. Balloon / blimp tiers — `✓` exact tier set, `~` original blimp names

- **Regular bloons** — `✓`. Exact canonical order and membership: Red, Blue,
  Green, Yellow, Pink, Black, White, Purple, Lead, Zebra, Rainbow, Ceramic
  (canon Ceramic is the topmost shield-tier). Properties like camo/regrow map
  onto zygote-level stat flags in the balloon defs.
- **MOAB-class blimps** — `~`. Canonical MOAB → BFB → ZOMG → DDT → BAD are
  present *mechanically* as escalating HP/slow/radius "super" bloons but under
  original names: GOLIATH, WRAITH, LEVIATHAN, COLOSSUS, OMEN. Deliberate rename
  (rule above); the escalating-boss-blimp slot matches canon.
- **Boss bloons** — rooted in the dedicated Boss system below.

## 3. Tower system — `✓` strong parity

- **Categories** — `✓`. Primary (8), Military (8), Magic (8), Support (7) = 31
  towers, mirroring canon's four base categories.
- **Heroes** — `✓`. 20 original-named heroes, auto-leveling during a match the
  way BTD6 heroes do (16+ canon heroes).
- **Paragons** — `✓`. A full 16-paragon upgrade/"Tier-6" system is present,
  mirroring canon's paragon meta-absorption of same-type towers.
- **Tower XP / upgrades** — `✓`. Per-tower XP is earned in-match and spent on
  persistent upgrade paths outside matches; heroes level up during gameplay.
- **Insta-Monkeys** — `–`. Not present. (See economy gap below.)

## 4. Modes — `✓` most canon modes, plus originals

17 modes. Direct canon matches:

| Overpop mode | BTD6 canon mode | status |
|---|---|---|
| Standard | Standard | ✓ |
| Alternate Waves | Alternate Bloons Rounds | ✓ |
| Half Cash | Half Cash | ✓ |
| Double HP Blimps | Double HP MOABs | ✓ (rename) |
| Deflation | Deflation | ✓ |
| Reverse | Reverse | ✓ |
| Purist | Purist | ✓ |
| Primary Only | Primary Only | ✓ |
| Military Only | Military Only | ✓ |
| Magic Only | Magic Monkeys Only | ✓ |
| Boss Event / Boss Event (Elite) | Boss Bloon Event | ✓ (see §6) |
| Rush Trial | Race Event | ~ |

Overpop originals (no canon twin): **Onslaught**, **Grim**, **Rampart**,
**Tag Team**. Canon modes not present: **Apopalypse**, **C.H.I.M.P.S.** (the
big no-continue/no-knowledge/no-powers challenge), **Speed**, **Double Cash**.
CHIMPS in particular — one of BTD6's flagship challenge modes — is absent and
is the most-cited gap.

## 5. Powers & economy — `Δ`

- **Powers** — `~` partial. 4 persistent consumables exist (Wild Cache=cash,
  Hearthfruit=lives, Briar Snare=slow, Thunder Stone=AoE damage) — a small subset
  of canon's 15+.
- **Economy** — `Δ`. There is **no Monkey Money / cash-store currency**. Canon
  gates powers, Insta-Monkeys, and per-tower upgrades behind spendable currency
  and daily/race rewards; Overpop spends **Knowledge Points** and **Tower XP** on
  those meta-progression hooks instead. This is a design fork, not a bug — but it
  means powers are free inventory pickups and there is no shop, so **Insta-Monkeys
  and Monkey Teams are absent** as a consequence.

## 6. Boss Bloon Event — `✓` recently implemented to canon shape

Overpop now ships a weekly rotating Boss Event (added `2bcc814`) whose rules are
literally BTD6's Boss Bloon Event contract:

- a boss featured per **weekly rotation** around the roster ✓
- **5 tiered HP pools**, boss advances every 20 rounds ✓
- **Elite unlock gated** behind completing Normal tiers ✓
- per-tier completion pays rewards; full-clear bonus ✓

Roster is 3 original bosses (Elder Worm, Storm Drake, Void Maw) vs canon's 6
(Bloonarius, Lych, Vortex, Dreadbloon, Phayze, Blastapopoulos) — same mechanic,
original names and roster size.

## 7. Legends — `✓` faithful rogue-lite framing

Local **Legends** is explicitly "our Rogue Legends". Parity with canon *Rogue
Legends* (BTD6 v47 paid DLC):

| mechanic | status |
|---|---|
| 4-stage escalating campaign | ✓ (canon is 4 stages w/ escalating rules) |
| Tiled node board (Battle / Elite / Chest / Merchant / Boss / Mini-game) | ✓ (canon hex-tile map with encounters) |
| Final boss per stage gating your run | ✓ |
| Artifacts = passive buffs that stack over the run | ✓ (28 local vs ~85 canon) |
| Cash/lives carry between battles | ✓ |
| Mini-game tiles (Least Cash, Race, Endurance) | ✓ (canon has mini challenges) |
| Rarity weighting (common/rare/legendary) rising over stages | ✓ |
| Start-with-a-Hero + Insta Monkey + Boosts meta | `–` (no hero/insta/boost in local Legends) |
| Merchant tile | ✓ (canon lets you buy/sell/markup) |

The broad architecture maps cleanly; the local build is a smaller content slice
(28 artifacts vs 85+; no heroes/boosts inside Legends). No Frontier-Legends /
ranch-hands content.

## 8. Playthrough observation (triangle split)

`node tools/playthroughs.mjs` played the full difficulty×mode matrix. Numbers
are from real headless runs:

- **Reference build holds easy standard on all 4 test maps** (40/40, 24 towers,
  ~64–68 lives to spare) — a winnable Easy.
- **The same reference build leaks on every medium/hard/relentless combo and on
  every alternate mode** on those maps (68 balance warnings). The reference bot
  is deliberately un-clever, but holding *zero* medium+ runs across 4 maps is a
  tuning signal that the post-Easy curve bites hard.
- Inadequate (one-cheap-tower) builds leak as they must, and RNG is
  deterministic → the game's failure path is sound and testable.

This is the *one* area where the local game deliberately departs from canon's
feel: BTD6 reference builds comfortably clear medium+; the local difficulty
ladder currently gates more steeply.

## Sources (canon)

- Blooncyclopedia — Bloons TD 6, Difficulty, MOAB-Class Bloon, Paragon, Upgrade,
  Power, Insta Monkey, Legend, Rogue Legends, Boss Bloon Event
  (`https://www.bloonswiki.com/...`)
- Fandom BTD6 — Bloons TD 6, Difficulty, Powers
  (`https://bloons.fandom.com/wiki/...`)
- Steam — Bloons TD 6: Rogue Legends
  (`https://store.steampowered.com/app/3377850/...`)

## Suggested next steps

1. ~~Add a **CHIMPS**-style no-continues mode (biggest canon gap).~~ **Done** — delivered
   as the **NO MERCY** mode (no selling, no income, no continues, no powers, no
   skill tree, one life, 80 rounds). It uses an original name because the project's
   no-borrowed-proper-nouns gate bans the literal "CHIMPS" (see `tools/suites/modes.mjs`).
2. Decide the **economy fork**: keep Knowledge-Points-only (document it) or add a
   spendable currency + shop to unlock powers/Insta-Monkeys.
3. ~~Content-close **Legends** (more artifacts; optionally hero/boost nodes).~~
   **Artifacts done** — the pool grew from 9 to 28 (13 common / 9 rare / 6
   legendary), every one riding the engine's real buff + rules vocabularies, with
   a suite gate keeping new entries honest. **Still open:** hero and boost nodes
   inside Legends (the `–` rows in §7).
4. Rebalance the **medium+ reference curve** so a competent generic build can
   hold at least Medium Standard (currently 0/4 maps).