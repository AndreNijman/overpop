/**
 * TROPHIES — the Trophy Store catalogue.
 *
 * The store is the cross-run cosmetic economy: trophies are BANKED by playing
 * (wins, boss tiers, dailies) and SPENT on four cosmetic kinds plus instant
 * critter crates. Nothing here changes a rule — a store item may carry a
 * `payload` (a colour, a label) that the renderer or results screen reads, but
 * no item touches tower stats, round tables or the economy. Cosmetics only;
 * gameplay advantage stays where it belongs (knowledge, tokens, XP).
 *
 * Kinds and what consumes them:
 *   trail  — projectile trail colour (payload.colour, read by fx)
 *   flag   — track-exit flag skin (payload.colour, read by terrain painter)
 *   badge  — title-screen account badge (payload.hue, read by menus)
 *   title  — player title shown on the results screen (payload.label)
 *   insta  — instant-critter crate (payload.towerKey/level; grants via Drafts)
 *
 * The data is a plain registry attaching to OP.TROPHIES; order arrays drive UI.
 */
;(function (OP) {
  'use strict'

  const ITEMS = {}

  function item (key, kind, name, blurb, cost, payload) {
    ITEMS[key] = Object.assign({ key: key, kind: kind, name: name, blurb: blurb, cost: cost }, payload || {})
  }

  /* ---------- trails (10) ---------- */
  item('trail-moss', 'trail', 'Moss Trails', 'A soft woodland green behind every projectile.', 2, { colour: '#7ec850' })
  item('trail-gold', 'trail', 'Golden Trails', 'A merchant-train glint behind every shot.', 4, { colour: '#ffd23f' })
  item('trail-ember', 'trail', 'Ember Trails', 'Warm sparks trail every throw.', 4, { colour: '#e2632c' })
  item('trail-frost', 'trail', 'Frost Trails', 'A cold mist follows the shots.', 4, { colour: '#9fd8ef' })
  item('trail-violet', 'trail', 'Violet Trails', 'Arcane dust hangs in the air.', 6, { colour: '#a06bd8' })
  item('trail-rose', 'trail', 'Rose Trails', 'A festival bloom follows the critters.', 6, { colour: '#e06b9a' })
  item('trail-ocean', 'trail', 'Ocean Trails', 'Deep blue wake behind every shot.', 6, { colour: '#3f7fd0' })
  item('trail-lime', 'trail', 'Lime Trails', 'Bright as spring growth.', 6, { colour: '#a8d84a' })
  item('trail-onyx', 'trail', 'Onyx Trails', 'A dark ribbon, visible on any terrain.', 8, { colour: '#3a3a44' })
  item('trail-rainbow', 'trail', 'Prismatic Trails', 'The critics applaud in full colour.', 12, { colour: '#ff7bd5' })

  /* ---------- flags (8) ---------- */
  item('flag-riverside', 'flag', 'Riverside Standard', 'The track exit flies a cool blue pennant.', 2, { colour: '#4d7f96' })
  item('flag-sunburst', 'flag', 'Sunburst Standard', 'A warm gold flag marks the exit.', 3, { colour: '#e8b13c' })
  item('flag-clover', 'flag', 'Clover Standard', 'Luck for every balloon that makes it this far — they will not.', 3, { colour: '#4f9b3d' })
  item('flag-nightfall', 'flag', 'Nightfall Standard', 'A deep violet banner for the evening shift.', 4, { colour: '#5a3d8f' })
  item('flag-rune', 'flag', 'Runic Standard', 'The exit bears a warding sigil.', 6, { colour: '#7de8c6' })
  item('flag-crimson', 'flag', 'Crimson Standard', 'No balloon passes under this one smiling.', 4, { colour: '#d1493c' })
  item('flag-pearl', 'flag', 'Pearl Standard', 'Bright white, easy to spot, hard to earn.', 8, { colour: '#f2ede2' })
  item('flag-crown', 'flag', 'Crowned Standard', 'The exit flag wears the laurel of long campaigns.', 10, { colour: '#ffd23f' })

  /* ---------- badges (12) — shown beside the record on the title screen ---------- */
  item('badge-oak', 'badge', 'Oak Badge', 'Steady as the trunk.', 2, { glyph: 'OAK' })
  item('badge-fawn', 'badge', 'Fawn Badge', 'For the early steps of a long career.', 2, { glyph: 'FAWN' })
  item('badge-falcon', 'badge', 'Falcon Mark', 'Fast eyes, faster rounds.', 3, { glyph: 'FLCN' })
  item('badge-bear', 'badge', 'Bear Crest', 'Heavy rounds, heavier shoulders.', 4, { glyph: 'BEAR' })
  item('badge-owl', 'badge', 'Owl Sigil', 'The wisdom tree approves.', 4, { glyph: 'OWL' })
  item('badge-fox', 'badge', 'Fox Crest', 'Clever, quick, always throwing.', 5, { glyph: 'FOX' })
  item('badge-hare', 'badge', 'Hare Sigil', 'The frost that slows the world.', 5, { glyph: 'HARE' })
  item('badge-boar', 'badge', 'Boar Crest', 'A siege engine with tusks.', 6, { glyph: 'BOAR' })
  item('badge-toad', 'badge', 'Ember Toad Sigil', 'The cinder brood remembers.', 8, { glyph: 'TOAD' })
  item('badge-warden', 'badge', 'Warden Sigil', 'It does not attack — it feeds.', 8, { glyph: 'WRDN' })
  item('badge-colossus', 'badge', 'Quarry Sigil', 'A walking mountain, walked down.', 10, { glyph: 'COLS' })
  item('badge-phoenix', 'badge', 'Phoenix Crest', 'Earned by coming back, again and again.', 12, { glyph: 'PHX' })

  /* ---------- titles (10) — shown on the results screen ---------- */
  item('title-sprout', 'title', 'Title: Sprout', 'Everyone starts somewhere.', 1, { label: 'Sprout' })
  item('title-scout', 'title', 'Title: Pathfinder', 'You know these woods now.', 2, { label: 'Pathfinder' })
  item('title-popsmith', 'title', 'Title: Popsmith', 'Counting balloons is a craft.', 3, { label: 'Popsmith' })
  item('title-warden', 'title', 'Title: Warden of the Wood', 'The forest has a name for you.', 4, { label: 'Warden of the Wood' })
  item('title-goliath', 'title', 'Title: Goliath Breaker', 'You popped the first blimp and lived to brag.', 5, { label: 'Goliath Breaker' })
  item('title-veilhunter', 'title', 'Title: Veilhunter', 'Camo never fooled you twice.', 5, { label: 'Veilhunter' })
  item('title-blizzard', 'title', 'Title: Blizzard Marshal', 'The frost answers to you.', 6, { label: 'Blizzard Marshal' })
  item('title-quarrybane', 'title', 'Title: Quarrybane', 'Mountains fall before your board.', 8, { label: 'Quarrybane' })
  item('title-relentless', 'title', 'Title: The Relentless', 'You went the distance, every round of it.', 10, { label: 'The Relentless' })
  item('title-critic', 'title', 'Title: Critic of Critics', 'The judges have judged you worthy of judging.', 12, { label: 'Critic of Critics' })

  /* ---------- insta crates (8) — instant critters via Draft Tokens ---------- */
  item('crate-basic', 'insta', 'Starter Crate', 'Three basic critters, ready to place free.', 3, { crate: 'basic' })
  item('crate-sharp', 'insta', 'Sharpshooters Crate', 'Two critters of the primary line.', 4, { crate: 'primary' })
  item('crate-siege', 'insta', 'Siege Crate', 'Two critters of the military line.', 4, { crate: 'military' })
  item('crate-arcane', 'insta', 'Arcane Crate', 'Two critters of the magic line.', 5, { crate: 'magic' })
  item('crate-support', 'insta', 'Support Crate', 'Two critters of the support line.', 5, { crate: 'support' })
  item('crate-veteran', 'insta', 'Veteran Crate', 'Two mid-level critters from anywhere in the roster.', 8, { crate: 'veteran' })
  item('crate-elite', 'insta', 'Elite Crate', 'One high-level critter from anywhere in the roster.', 12, { crate: 'elite' })
  item('crate-legend', 'insta', 'Legend Crate', 'One top-level critter. Save it for the era that earns it.', 18, { crate: 'legend' })

  OP.TROPHY_ITEMS = ITEMS
  OP.TROPHY_ORDER = Object.keys(ITEMS)

  OP.TrophyKinds = ['trail', 'flag', 'badge', 'title', 'insta']

  OP.trophyByKey = function (key) {
    return Object.prototype.hasOwnProperty.call(ITEMS, key) ? ITEMS[key] : null
  }

  OP.trophyItemsOfKind = function (kind) {
    const out = []
    for (const key of OP.TROPHY_ORDER) {
      if (ITEMS[key].kind === kind) out.push(ITEMS[key])
    }
    return out
  }
})(window.OP)
