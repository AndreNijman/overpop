;(function (OP) {
  'use strict'

  const P = OP.PROP

  /* The balloon ladder. Ordered by red-balloon-equivalent (RBE), weakest first,
     which is also the order the bestiary displays and the order `strong`
     targeting compares against.

     Simple tiers are named for colours and materials — generic English nouns.
     The blimp class is original: GOLIATH, WRAITH, LEVIATHAN, COLOSSUS, OMEN.

     RBE is never written down here. It is computed from hp + children by
     OP.balloonRBE(), because a hardcoded table rots the instant anyone tunes an
     HP value and then every balance claim in the project is quietly wrong. */

  OP.BALLOON_TIERS = [
    {
      key: 'red', name: 'Red', hp: 1, speed: 1.0, radius: 6,
      colour: '#c9342f', shade: '#8e211d',
      children: [], immune: [], props: 0, cash: 1,
      blurb: 'One layer, no tricks. Everything else is this, wearing more.'
    },
    {
      key: 'blue', name: 'Blue', hp: 1, speed: 1.4, radius: 6.5,
      colour: '#3a7fd5', shade: '#25548f',
      children: [{ tier: 'red', count: 1 }], immune: [], props: 0, cash: 1,
      blurb: 'Slightly quicker, and there is a red one underneath.'
    },
    {
      key: 'green', name: 'Green', hp: 1, speed: 1.8, radius: 7,
      colour: '#3f9e4d', shade: '#256632',
      children: [{ tier: 'blue', count: 1 }], immune: [], props: 0, cash: 1,
      blurb: 'The last of the balloons you can ignore.'
    },
    {
      key: 'yellow', name: 'Yellow', hp: 1, speed: 3.2, radius: 7,
      colour: '#e0c020', shade: '#a08812',
      children: [{ tier: 'green', count: 1 }], immune: [], props: 0, cash: 1,
      blurb: 'Fast enough to punish a gap in your coverage.'
    },
    {
      key: 'pink', name: 'Pink', hp: 1, speed: 3.5, radius: 7.5,
      colour: '#e06aa8', shade: '#a53f77',
      children: [{ tier: 'yellow', count: 1 }], immune: [], props: 0, cash: 1,
      blurb: 'The fastest of the simple layers. Nothing hides behind it.'
    },
    {
      key: 'black', name: 'Black', hp: 1, speed: 1.8, radius: 6,
      colour: '#2b2b2f', shade: '#141417',
      children: [{ tier: 'pink', count: 2 }], immune: ['explosive'], props: 0, cash: 1,
      blurb: 'Explosions do nothing. Bring something sharp.'
    },
    {
      key: 'white', name: 'White', hp: 1, speed: 2.0, radius: 6,
      colour: '#e9edf2', shade: '#b3bcc7',
      children: [{ tier: 'pink', count: 2 }], immune: ['cold'], props: 0, cash: 1,
      blurb: 'Already cold. Freezing it achieves nothing.'
    },
    {
      key: 'purple', name: 'Purple', hp: 1, speed: 3.0, radius: 7,
      colour: '#8b4fc9', shade: '#5c2f8c',
      children: [{ tier: 'pink', count: 2 }], immune: ['fire', 'plasma', 'energy'], props: 0, cash: 1,
      blurb: 'Shrugs off anything that glows. Physical damage only.'
    },
    {
      key: 'lead', name: 'Lead', hp: 1, speed: 1.0, radius: 6.5,
      colour: '#6f7480', shade: '#43474f',
      children: [{ tier: 'black', count: 2 }], immune: ['sharp'], props: 0, cash: 1,
      blurb: 'Darts glance off. Blunt force, fire or shatter damage gets through.'
    },
    {
      key: 'zebra', name: 'Zebra', hp: 1, speed: 1.8, radius: 7,
      colour: '#f2f2f4', shade: '#2b2b2f',
      children: [{ tier: 'black', count: 1 }, { tier: 'white', count: 1 }],
      immune: ['explosive', 'cold'], props: 0, cash: 1,
      blurb: 'Both immunities at once, and it splits into both parents.'
    },
    {
      key: 'rainbow', name: 'Rainbow', hp: 1, speed: 2.2, radius: 8,
      colour: '#57c7c1', shade: '#2f8f8a', rainbow: true,
      children: [{ tier: 'zebra', count: 2 }], immune: [], props: 0, cash: 1,
      blurb: 'No immunities, but forty-seven layers of consequence.'
    },
    {
      key: 'ceramic', name: 'Ceramic', hp: 10, speed: 2.5, radius: 9,
      colour: '#b5622f', shade: '#7a3d1a',
      children: [{ tier: 'rainbow', count: 2 }], immune: [], props: 0, cash: 2,
      blurb: 'Ten hits of shell before it even starts splitting. Damage matters here.'
    },

    /* ---------- blimp class ---------- */

    {
      key: 'goliath', name: 'GOLIATH', hp: 200, speed: 1.0, radius: 22,
      colour: '#c8452f', shade: '#7d2418', blimp: true,
      children: [{ tier: 'ceramic', count: 4 }], immune: [], props: 0, cash: 25,
      stunImmune: true, slowResist: 0.5,
      blurb: 'The first blimp. Two hundred hits, then four ceramics.'
    },
    {
      key: 'wraith', name: 'WRAITH', hp: 400, speed: 2.75, radius: 20,
      colour: '#2f2b3a', shade: '#15131c', blimp: true,
      children: [{ tier: 'ceramic', count: 4 }],
      immune: ['sharp', 'explosive'], props: P.VEILED, cash: 25,
      stunImmune: true, slowResist: 0.5,
      blurb: 'Fast, veiled, and immune to sharp and explosive. Everything at once.'
    },
    {
      key: 'leviathan', name: 'LEVIATHAN', hp: 700, speed: 0.25, radius: 30,
      colour: '#2f6b9e', shade: '#1a3f60', blimp: true,
      children: [{ tier: 'goliath', count: 4 }], immune: [], props: 0, cash: 60,
      stunImmune: true, slowResist: 0.5,
      blurb: 'Slow, enormous, and it arrives with four GOLIATHs inside.'
    },
    {
      key: 'colossus', name: 'COLOSSUS', hp: 4000, speed: 0.18, radius: 40,
      colour: '#4b8f3c', shade: '#2a5722', blimp: true,
      children: [{ tier: 'leviathan', count: 4 }], immune: [], props: 0, cash: 150,
      stunImmune: true, slowResist: 0.35,
      blurb: 'Four thousand hits of hull. If it reaches you, the run is over.'
    },
    {
      key: 'omen', name: 'OMEN', hp: 20000, speed: 0.18, radius: 52,
      colour: '#1c1a22', shade: '#0b0a0f', blimp: true,
      children: [{ tier: 'colossus', count: 2 }, { tier: 'wraith', count: 3 }],
      immune: [], props: 0, cash: 400,
      stunImmune: true, slowResist: 0.2, abilityImmune: true,
      blurb: 'The last thing the track sends. Immune to instant-kill effects.'
    }
  ]

  /* ---------- lookup tables, built once ---------- */

  OP.BALLOON_INDEX = {}
  OP.BALLOON_TIERS.forEach(function (tier, i) {
    tier.index = i
    // Immunity lookup as an object so the hot path is a property read, not an
    // Array.includes scan. See ARCHITECTURE.md §3 — a table, never an if-chain.
    tier.immuneSet = {}
    tier.immune.forEach(function (d) { tier.immuneSet[d] = true })
    OP.BALLOON_INDEX[tier.key] = i
  })

  OP.tier = function (i) { return OP.BALLOON_TIERS[i] }
  OP.tierIndex = function (key) {
    const i = OP.BALLOON_INDEX[key]
    if (i === undefined) throw new Error('unknown balloon tier: ' + key)
    return i
  }
  OP.tierByKey = function (key) { return OP.BALLOON_TIERS[OP.tierIndex(key)] }

  /** Highest tier index that is not a blimp — the boundary the bestiary and the
      "strong" targeting tiebreak both care about. */
  OP.LAST_SIMPLE_TIER = OP.BALLOON_TIERS.reduce(function (acc, t, i) { return t.blimp ? acc : i }, 0)
  OP.FIRST_BLIMP_TIER = OP.LAST_SIMPLE_TIER + 1
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
