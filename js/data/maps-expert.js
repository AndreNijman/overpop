;(function (OP) {
  'use strict'

  /* ============================================================================
     EXPERT MAPS — four of them, and they are the hardest ground in the game.

     The authored format, its validation rules and the placement-mask ORDER all
     live in js/core/maps.js. Read that file's header first.

     What "expert" means, concretely, and what
     tools/suites/map-roster-late.mjs holds these four to:

       · Each map is hard for ONE named structural reason, and the four reasons
         are different:
             Bramble Gap        a very short lane. Nothing arrives late, so the
                                answer is raw damage per second, not layering.
             Thricefall Combes  three lanes in three separate combes. No tower
                                can watch two of them, so the defence is split
                                three ways whether you like it or not.
             Sunken Mire        almost no dry ground. Over half the field is
                                water, so the water towers stop being optional.
             Bracken Verge      the drove road runs the whole way round the
                                field and the middle is bog: most of the map is
                                legal, useless, or both. This is the nasty one.
       · 15-36% of the field is buildable for a land tower, against 42%+ on
         advanced. The suite asserts the tier separation directly, so an expert
         map that drifts open fails rather than quietly becoming an advanced one.
       · TRACK LENGTH 1800-4500 units, measured as Maps.totalPathLength — the SUM
         across lanes. Short is a difficulty setting here, not an oversight:
         Bramble Gap sits at the bottom of the band on purpose.
       · Every authored line-of-sight blocker is ALSO listed in `blocked`. The
         painter draws blockers in `palette.rock`, so a wall you could build on
         top of would read as a bug; the `walls` const in each map is spliced
         into both lists.
       · Every one of these four is COMPLETABLE, and the suite proves it by
         playing the whole of Easy (rounds 1-40, ending on the lone GOLIATH) with
         a reference build placed only on ground the map's own mask allows, and
         asserting the run ends `won` with no life lost. If a map here ever stops
         being winnable the map gets fixed, not the test.

     `smooth: 3` is a Catmull-Rom pass whose tangent at a control point is
     (next - prev) / 2, so a SHORT segment between two long ones overshoots its
     own endpoint and define() rejects the lane for leaving the field. The long
     legs of Bracken Verge are therefore SUBDIVIDED into 150-220 unit pieces
     rather than authored as one 1200-unit run into a 60-unit corner ramp, and
     the suite re-checks every lane's bounds() after smoothing.
     ============================================================================ */

  /* ---------------------------------------------------------------- 1 of 4 --
     BRAMBLE GAP — one lane, 1800-odd units, straight through the thicket. The
     bramble takes the corners of the field and the pools take the middle of the
     bend, so the ground that is left is a narrow corridor beside the road, and
     everything you own has to kill on the first pass. */

  const GAP_THICKET_N = { x: 320, y: 0, w: 780, h: 84 }
  const GAP_THICKET_S = { x: 280, y: 600, w: 570, h: 120 }
  const GAP_WALLS = [
    GAP_THICKET_N,
    GAP_THICKET_S,
    { x: 230, y: 300, w: 24, h: 120 },
    { x: 1050, y: 200, w: 24, h: 130 }
  ]

  /* ---------------------------------------------------------------- 2 of 4 --
     THRICEFALL COMBES — three identical combes, translated. Written as a loop so
     the three lanes and their fills cannot drift apart under a retune, and so
     "the combes are the same shape" is a property of the file rather than a
     claim in a comment. */

  const COMBE_DX = [0, 420, 840]

  function combe (dx, name) {
    return {
      name: name,
      smooth: 3,
      points: [
        { x: 200 + dx, y: 0 }, { x: 200 + dx, y: 90 }, { x: 80 + dx, y: 175 },
        { x: 80 + dx, y: 300 }, { x: 330 + dx, y: 390 }, { x: 330 + dx, y: 500 },
        { x: 90 + dx, y: 590 }, { x: 90 + dx, y: 720 }
      ]
    }
  }

  const COMBE_WATER = [
    { x: 246, y: 0, w: 174, h: 290 },      // the head pool
    { x: 110, y: 420, w: 100, h: 80 },     // the plunge pool
    { x: 0, y: 330, w: 40, h: 240 }        // the leat
  ]
  const COMBE_BLOCKED = [
    { x: 0, y: 0, w: 140, h: 80 },
    { x: 372, y: 430, w: 48, h: 290 },
    { x: 150, y: 650, w: 270, h: 70 },
    { x: 270, y: 570, w: 150, h: 80 }
  ]
  const COMBE_WALL = { x: 246, y: 120, w: 24, h: 170 }

  function shift (list, dx) {
    return list.map(function (r) {
      return Object.assign({}, r, { x: r.x + dx })
    })
  }
  function perCombe (list) {
    let out = []
    for (let i = 0; i < COMBE_DX.length; i++) out = out.concat(shift(list, COMBE_DX[i]))
    return out
  }

  const COMBE_WALLS = perCombe([COMBE_WALL])

  /* ---------------------------------------------------------------- 3 of 4 --
     SUNKEN MIRE — two causeways over a drowned wood. The two lanes are exact
     reflections of each other about y = 360, so the water is authored once for
     the north half and mirrored; that keeps the two halves honest and means a
     clearance verified on one bank is verified on both.

     The three water bands are STRAIGHT and run right up to the road margin, so
     the dry ground is only the pockets the serpentine leaves behind. Over half
     the field ends up water: the water towers are the point of this map. */

  const MIRE_WALLS = [
    { x: 560, y: 300, w: 200, h: 22 },
    { x: 240, y: 330, w: 200, h: 22 },
    { x: 920, y: 330, w: 200, h: 22 }
  ]

  function mirrored (list) {
    return list.concat(list.map(function (r) {
      return Object.assign({}, r, { y: 720 - r.y - r.h })
    }))
  }

  /* ---------------------------------------------------------------- 4 of 4 --
     BRACKEN VERGE — the drove road leaves the west edge, runs the whole way
     round the field and comes back out of the west edge lower down. Everything
     that shoots lives on the verge: a 50-70 unit ring between the road margin
     and the bog, and four dry-stone walls sit in that ring's sight line, so part
     of the verge is legal ground that cannot see the road at all.

     The middle is peat bog. Its RIM is real estate — a water tower moored there
     is about 63 units off the road, which the suite checks — but the bog is 950
     by 425 and everything inside the first tower-range of its edge is legal,
     unreachable, and therefore worthless. That is the map: the biggest single
     region on it is the one you cannot use. It is the nastiest map in the game
     and it is meant to be. */

  const VERGE_WALLS = [
    { x: 300, y: 96, w: 220, h: 22 },
    { x: 760, y: 96, w: 220, h: 22 },
    { x: 1150, y: 300, w: 22, h: 200 },
    { x: 420, y: 610, w: 240, h: 22 }
  ]

  const MAPS = [
    {
      key: 'bramble-gap',
      name: 'Bramble Gap',
      tier: 'expert',
      blurb: 'One short cut through the thicket. Nothing arrives late here, so whatever you build has to kill it on the way past.',
      trackWidth: 34,

      paths: [
        { name: 'The Cut',
          smooth: 3,
          points: [
            { x: 0, y: 330 }, { x: 140, y: 340 }, { x: 240, y: 260 }, { x: 300, y: 150 },
            { x: 430, y: 120 }, { x: 540, y: 200 }, { x: 600, y: 330 }, { x: 680, y: 460 },
            { x: 790, y: 565 }, { x: 930, y: 585 }, { x: 1040, y: 480 }, { x: 1110, y: 350 },
            { x: 1170, y: 250 }, { x: 1240, y: 270 }, { x: 1280, y: 330 }
          ] }
      ],

      water: [
        { cx: 330, cy: 480, r: 95 },
        { cx: 500, cy: 480, r: 75 },
        { cx: 990, cy: 180, r: 85 },
        { cx: 860, cy: 300, r: 75 },
        { cx: 400, cy: 270, r: 70 }
      ],

      blocked: [
        { x: 0, y: 0, w: 210, h: 200 },
        { x: 1150, y: 0, w: 130, h: 190 },
        { x: 1130, y: 390, w: 150, h: 330 },
        { x: 860, y: 622, w: 320, h: 98 },
        { x: 0, y: 440, w: 250, h: 280 },
        { cx: 700, cy: 220, r: 80 },
        { cx: 890, cy: 430, r: 65 }
      ].concat(GAP_WALLS),

      blockers: GAP_WALLS,

      removable: [
        { x: 290, y: 380, r: 30, cost: 320, name: 'Thorn Bale', blocksLOS: true },
        { x: 990, y: 360, r: 30, cost: 320, name: 'Bramble Mound', blocksLOS: true },
        { x: 500, y: 90, r: 26, cost: 220, name: 'Split Stump' }
      ],

      palette: {
        base: '#100f0c',
        grass: '#3b4a2b',
        grassAlt: '#4a5c34',
        path: '#75603b',
        pathEdge: '#4f3d21',
        water: '#26424c',
        rock: '#5c5648',
        accent: '#d9a83a',
        fog: '#100f0c'
      }
    },

    {
      key: 'thricefall-combes',
      name: 'Thricefall Combes',
      tier: 'expert',
      blurb: 'Three brooks fall through three separate combes, and nothing you build can watch more than one of them.',
      trackWidth: 38,

      paths: [combe(COMBE_DX[0], 'West Combe'), combe(COMBE_DX[1], 'Middle Combe'), combe(COMBE_DX[2], 'East Combe')],

      water: perCombe(COMBE_WATER),
      blocked: perCombe(COMBE_BLOCKED).concat(COMBE_WALLS),
      blockers: COMBE_WALLS,

      removable: [
        { x: 60, y: 400, r: 26, cost: 300, name: 'Fern Bank', blocksLOS: true },
        { x: 480, y: 400, r: 26, cost: 300, name: 'Moss Boulder', blocksLOS: true },
        { x: 900, y: 400, r: 26, cost: 300, name: 'Hazel Snag', blocksLOS: true }
      ],

      palette: {
        base: '#0a110f',
        grass: '#2f4a34',
        grassAlt: '#3b5c40',
        path: '#665739',
        pathEdge: '#42351f',
        water: '#245262',
        rock: '#525349',
        accent: '#c2a744',
        fog: '#0a110f'
      }
    },

    {
      key: 'sunken-mire',
      name: 'Sunken Mire',
      tier: 'expert',
      blurb: 'Two causeways over a drowned wood. There is almost nowhere dry left to stand, so learn to like the water.',
      trackWidth: 30,

      paths: [
        { name: 'North Causeway',
          smooth: 3,
          points: [
            { x: 0, y: 200 }, { x: 160, y: 175 }, { x: 320, y: 215 }, { x: 470, y: 262 },
            { x: 620, y: 210 }, { x: 770, y: 168 }, { x: 910, y: 205 }, { x: 1030, y: 258 },
            { x: 1160, y: 215 }, { x: 1280, y: 178 }
          ] },
        { name: 'South Causeway',
          smooth: 3,
          points: [
            { x: 0, y: 520 }, { x: 160, y: 545 }, { x: 320, y: 505 }, { x: 470, y: 458 },
            { x: 620, y: 510 }, { x: 770, y: 552 }, { x: 910, y: 515 }, { x: 1030, y: 462 },
            { x: 1160, y: 505 }, { x: 1280, y: 542 }
          ] }
      ],

      water: [
        { x: 0, y: 0, w: 1280, h: 134 },      // the north flood
        { x: 0, y: 296, w: 1280, h: 128 },    // the channel between the causeways
        { x: 0, y: 586, w: 1280, h: 134 }     // the south flood
      ],

      blocked: mirrored([
        { x: 430, y: 138, w: 100, h: 42 },
        { x: 960, y: 138, w: 100, h: 42 }
      ]).concat([
        { cx: 40, cy: 360, r: 40 },
        { cx: 1240, cy: 360, r: 40 }
      ]).concat(MIRE_WALLS),

      blockers: MIRE_WALLS,

      removable: [
        { x: 640, y: 360, r: 30, cost: 340, name: 'Drowned Oak', blocksLOS: true },
        { x: 470, y: 200, r: 28, cost: 300, name: 'Sedge Tussock' },
        { x: 1030, y: 196, r: 28, cost: 300, name: 'Peat Hag' }
      ],

      palette: {
        base: '#0b100f',
        grass: '#354b31',
        grassAlt: '#425c3a',
        path: '#6c5a3e',
        pathEdge: '#473722',
        water: '#1f3b46',
        rock: '#4f4f47',
        accent: '#c6a63c',
        fog: '#0b100f'
      }
    },

    {
      key: 'bracken-verge',
      name: 'Bracken Verge',
      tier: 'expert',
      blurb: 'The drove road runs the whole way round the field and the middle is bog, so everything you own lives on the verge.',
      trackWidth: 32,

      paths: [
        { name: 'The Drove',
          smooth: 3,
          points: [
            { x: 0, y: 62 }, { x: 150, y: 58 }, { x: 340, y: 56 }, { x: 540, y: 56 },
            { x: 740, y: 56 }, { x: 940, y: 58 }, { x: 1120, y: 66 }, { x: 1200, y: 110 },
            { x: 1224, y: 200 }, { x: 1224, y: 380 }, { x: 1224, y: 540 }, { x: 1190, y: 630 },
            { x: 1100, y: 664 }, { x: 900, y: 668 }, { x: 700, y: 668 }, { x: 500, y: 668 },
            { x: 300, y: 664 }, { x: 160, y: 630 }, { x: 100, y: 540 }, { x: 96, y: 400 },
            { x: 96, y: 300 }, { x: 60, y: 250 }, { x: 0, y: 240 }
          ] }
      ],

      water: [
        { x: 185, y: 150, w: 950, h: 425 }     // the peat bog
      ],

      blocked: [
        { x: 1140, y: 160, w: 52, h: 110 },
        { x: 0, y: 560, w: 90, h: 90 },
        { x: 185, y: 580, w: 180, h: 48 }
      ].concat(VERGE_WALLS),

      blockers: VERGE_WALLS,

      removable: [
        { x: 620, y: 130, r: 28, cost: 340, name: 'Verge Boulder', blocksLOS: true },
        { x: 720, y: 600, r: 28, cost: 340, name: 'Gorse Clump', blocksLOS: true },
        { x: 155, y: 400, r: 26, cost: 280, name: 'Hedge Stub' },
        { x: 1163, y: 560, r: 26, cost: 280, name: 'Field Gate' }
      ],

      palette: {
        base: '#0e1110',
        grass: '#41502e',
        grassAlt: '#4f6236',
        path: '#78643c',
        pathEdge: '#513f22',
        water: '#1c3138',
        rock: '#5a564b',
        accent: '#dbb43f',
        fog: '#0e1110'
      }
    }
  ]

  for (let i = 0; i < MAPS.length; i++) OP.Maps.define(MAPS[i])

  /* See the note in js/data/maps-advanced.js: the roster is derived from MAPS so
     a fifth map cannot be added without the suite's count assertion seeing it. */
  OP.MAP_ROSTERS = OP.MAP_ROSTERS || {}
  OP.MAP_ROSTERS.expert = MAPS.map(function (m) { return m.key })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
