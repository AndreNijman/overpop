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
    },

    {
      key: 'shattered-spire',
      name: 'Shattered Spire',
      tier: 'expert',
      blurb: 'A single narrow lane spirals up a broken spire — almost no ground to build on, and the track doubles back on itself constantly.',
      trackWidth: 30,

      paths: [
        { name: 'The Spire',
          smooth: 3,
          points: [
            { x: 640, y: 720 }, { x: 640, y: 600 }, { x: 500, y: 550 }, { x: 780, y: 550 },
            { x: 780, y: 450 }, { x: 500, y: 450 }, { x: 500, y: 350 }, { x: 780, y: 350 },
            { x: 780, y: 250 }, { x: 500, y: 250 }, { x: 500, y: 150 }, { x: 780, y: 150 },
            { x: 780, y: 50 }, { x: 640, y: 0 }
          ] }
      ],

      water: [
        { cx: 200, cy: 360, r: 120 },
        { cx: 1080, cy: 360, r: 120 }
      ],

      blocked: [
        { x: 0, y: 0, w: 280, h: 720 },
        { x: 1000, y: 0, w: 280, h: 720 },
        { cx: 640, cy: 360, r: 80 }
      ].concat(VERGE_WALLS),

      blockers: VERGE_WALLS,

      removable: [
        { x: 640, y: 360, r: 28, cost: 360, name: 'Spire Core', blocksLOS: true },
        { x: 640, y: 500, r: 26, cost: 320, name: 'Fractured Pillar', blocksLOS: true },
        { x: 640, y: 220, r: 24, cost: 280, name: 'Hanging Rock' },
        { x: 640, y: 680, r: 22, cost: 240, name: 'Loose Debris' }
      ],

      palette: {
        base: '#0c1012',
        grass: '#3a4a34',
        grassAlt: '#465c3e',
        path: '#705e3d',
        pathEdge: '#4a3c24',
        water: '#1a2f3a',
        rock: '#5d5850',
        accent: '#d4b840',
        fog: '#0c1012'
      }
    },

    {
      key: 'void-maw',
      name: 'Void Maw',
      tier: 'expert',
      blurb: 'A single path spirals down into a chasm and back out — the void watches and waits.',
      trackWidth: 28,

      paths: [{
        smooth: 5,
        points: [
          { x: 0, y: 360 }, { x: 120, y: 360 }, { x: 200, y: 280 }, { x: 320, y: 220 },
          { x: 480, y: 200 }, { x: 640, y: 240 }, { x: 760, y: 360 }, { x: 800, y: 500 },
          { x: 760, y: 620 }, { x: 640, y: 680 }, { x: 480, y: 660 }, { x: 360, y: 560 },
          { x: 320, y: 440 }, { x: 400, y: 360 }, { x: 560, y: 360 }, { x: 720, y: 360 },
          { x: 880, y: 360 }, { x: 1040, y: 360 }, { x: 1200, y: 360 }, { x: 1280, y: 360 }
        ]
      }],

      blockers: [
        { x: 520, y: 320, w: 60, h: 60 },
        { x: 680, y: 320, w: 60, h: 60 },
        { x: 600, y: 440, w: 60, h: 60 }
      ],

      removable: [
        { x: 440, y: 280, r: 24, cost: 400, name: 'Jagged Spire', blocksLOS: true },
        { x: 720, y: 440, r: 22, cost: 360, name: 'Fallen Pillar', blocksLOS: true }
      ],

      palette: {
        base: '#080a0c',
        grass: '#2a3a28',
        grassAlt: '#354830',
        path: '#68583c',
        pathEdge: '#443420',
        water: '#141e28',
        rock: '#4a4640',
        accent: '#c8b040'
      }
    },

    {
      key: 'abyssal-maw',
      name: 'Abyssal Maw',
      tier: 'expert',
      blurb: 'Three lanes spiral into a central chasm and out again — the abyss watches and waits.',
      trackWidth: 26,

      paths: [
        { name: 'Outer Ring',
          smooth: 5,
          points: [
            { x: 0, y: 360 }, { x: 120, y: 240 }, { x: 320, y: 160 }, { x: 560, y: 160 },
            { x: 760, y: 240 }, { x: 880, y: 360 }, { x: 760, y: 480 }, { x: 560, y: 560 },
            { x: 320, y: 560 }, { x: 120, y: 480 }, { x: 0, y: 360 }
          ] },
        { name: 'Inner Ring',
          smooth: 5,
          points: [
            { x: 200, y: 360 }, { x: 280, y: 280 }, { x: 420, y: 240 }, { x: 560, y: 280 },
            { x: 640, y: 360 }, { x: 560, y: 440 }, { x: 420, y: 480 }, { x: 280, y: 440 },
            { x: 200, y: 360 }
          ] },
        { name: 'Center',
          smooth: 4,
          points: [
            { x: 360, y: 360 }, { x: 440, y: 320 }, { x: 520, y: 360 }, { x: 520, y: 400 },
            { x: 440, y: 440 }, { x: 360, y: 400 }, { x: 360, y: 360 }
          ] }
      ],

      blockers: [
        { x: 480, y: 320, w: 40, h: 40 },
        { x: 480, y: 400, w: 40, h: 40 }
      ],

      removable: [
        { x: 440, y: 360, r: 20, cost: 500, name: 'Abyss Core', blocksLOS: true }
      ],

      palette: {
        base: '#060808',
        grass: '#1e2e1c',
        grassAlt: '#283822',
        path: '#584830',
        pathEdge: '#3a2e1a',
        water: '#0e1618',
        rock: '#3a3830',
        accent: '#b8a040'
      }
    },

    {
      key: 'void-heart',
      name: 'Void Heart',
      tier: 'expert',
      blurb: 'Three lanes spiral inward to a central void and back out — the heart of darkness beats at the centre.',
      trackWidth: 24,

      paths: [
        { name: 'North',
          smooth: 5,
          points: [
            { x: 640, y: 0 }, { x: 640, y: 120 }, { x: 600, y: 240 }, { x: 640, y: 320 },
            { x: 640, y: 400 }, { x: 640, y: 520 }, { x: 640, y: 600 }, { x: 640, y: 720 }
          ] },
        { name: 'South',
          smooth: 5,
          points: [
            { x: 640, y: 720 }, { x: 640, y: 600 }, { x: 680, y: 480 }, { x: 640, y: 400 },
            { x: 640, y: 320 }, { x: 640, y: 240 }, { x: 640, y: 120 }, { x: 640, y: 0 }
          ] },
        { name: 'East',
          smooth: 5,
          points: [
            { x: 1280, y: 360 }, { x: 1160, y: 360 }, { x: 1040, y: 400 }, { x: 960, y: 360 },
            { x: 880, y: 360 }, { x: 760, y: 360 }, { x: 640, y: 360 }
          ] }
      ],

      blockers: [
        { x: 560, y: 320, w: 40, h: 40 },
        { x: 720, y: 320, w: 40, h: 40 },
        { x: 560, y: 400, w: 40, h: 40 },
        { x: 720, y: 400, w: 40, h: 40 }
      ],

      removable: [
        { x: 640, y: 360, r: 22, cost: 600, name: 'Void Core', blocksLOS: true }
      ],

      palette: {
        base: '#040606',
        grass: '#161e14',
        grassAlt: '#1e2818',
        path: '#4a3c28',
        pathEdge: '#32261a',
        water: '#0a1010',
        rock: '#32302a',
        accent: '#a89038'
      }
    },

    {
      key: 'witchlight-bog',
      name: 'Witchlight Bog',
      tier: 'expert',
      blurb: 'Three paths through a phosphorescent bog — each one barely visible, none within reach of another.',
      trackWidth: 28,

      paths: [
        {
          name: 'North Thread',
          smooth: 3,
          points: [
            { x: 0, y: 120 }, { x: 200, y: 160 }, { x: 400, y: 120 }, { x: 600, y: 160 },
            { x: 800, y: 120 }, { x: 1000, y: 160 }, { x: 1280, y: 120 }
          ]
        },
        {
          name: 'Middle Thread',
          smooth: 3,
          points: [
            { x: 1280, y: 360 }, { x: 1000, y: 340 }, { x: 800, y: 360 }, { x: 600, y: 340 },
            { x: 400, y: 360 }, { x: 200, y: 340 }, { x: 0, y: 360 }
          ]
        },
        {
          name: 'South Thread',
          smooth: 3,
          points: [
            { x: 0, y: 600 }, { x: 200, y: 580 }, { x: 400, y: 600 }, { x: 600, y: 580 },
            { x: 800, y: 600 }, { x: 1000, y: 580 }, { x: 1280, y: 600 }
          ]
        }
      ],

      water: [
        { cx: 300, cy: 260, r: 35 },
        { cx: 980, cy: 460, r: 35 }
      ],

      blockers: [
        { x: 500, y: 220, w: 40, h: 30 },
        { x: 780, y: 460, w: 40, h: 30 }
      ],

      removable: [
        { x: 640, y: 260, r: 18, cost: 400, name: 'Witchlight Stone', blocksLOS: true },
        { x: 400, y: 460, r: 18, cost: 400, name: 'Glowing Mushroom', blocksLOS: true }
      ],

      palette: {
        base: '#040606',
        grass: '#161e14',
        grassAlt: '#1e2818',
        path: '#4a3c28',
        pathEdge: '#32261a',
        water: '#0a1010',
        rock: '#32302a',
        accent: '#60c080'
      }
    },

    {
      key: 'frostfang-peaks',
      name: 'Frostfang Peaks',
      tier: 'expert',
      blurb: 'Three icy ledges stacked high — a massive central pillar blocks most sightlines.',
      trackWidth: 28,

      paths: [
        {
          name: 'Upper Ridge',
          smooth: 3,
          points: [
            { x: 0, y: 100 }, { x: 200, y: 120 }, { x: 400, y: 100 }, { x: 600, y: 120 },
            { x: 800, y: 100 }, { x: 1000, y: 120 }, { x: 1280, y: 100 }
          ]
        },
        {
          name: 'Middle Ridge',
          smooth: 3,
          points: [
            { x: 1280, y: 360 }, { x: 1000, y: 340 }, { x: 800, y: 360 }, { x: 600, y: 340 },
            { x: 400, y: 360 }, { x: 200, y: 340 }, { x: 0, y: 360 }
          ]
        },
        {
          name: 'Lower Ridge',
          smooth: 3,
          points: [
            { x: 0, y: 600 }, { x: 200, y: 620 }, { x: 400, y: 600 }, { x: 600, y: 620 },
            { x: 800, y: 600 }, { x: 1000, y: 620 }, { x: 1280, y: 600 }
          ]
        }
      ],

      water: [{ cx: 640, cy: 240, r: 35 }, { cx: 640, cy: 480, r: 35 }],

      blockers: [
        { x: 580, y: 220, w: 120, h: 40 },
        { x: 580, y: 460, w: 120, h: 40 }
      ],

      removable: [
        { x: 300, y: 240, r: 18, cost: 350, name: 'Ice Pillar', blocksLOS: true },
        { x: 980, y: 480, r: 18, cost: 350, name: 'Frozen Spire', blocksLOS: true },
        { x: 640, y: 240, r: 15, cost: 250, name: 'Frost Shard' }
      ],

      palette: {
        base: '#040606',
        grass: '#161e14',
        grassAlt: '#1e2818',
        path: '#4a3c28',
        pathEdge: '#32261a',
        water: '#0a1010',
        rock: '#32302a',
        accent: '#a0c8e0'
      }
    },

    {
      key: 'ashfall-ridge',
      name: 'Ashfall Ridge',
      tier: 'expert',
      blurb: 'Two paths through an active volcanic ridge — ash clouds block vision and the ground is scarce.',
      trackWidth: 28,

      paths: [
        {
          name: 'West Crater',
          smooth: 3,
          points: [
            { x: 0, y: 200 }, { x: 150, y: 280 }, { x: 300, y: 360 }, { x: 450, y: 280 },
            { x: 600, y: 200 }, { x: 750, y: 280 }, { x: 900, y: 360 },
            { x: 1050, y: 280 }, { x: 1200, y: 200 }, { x: 1280, y: 200 }
          ]
        },
        {
          name: 'East Crater',
          smooth: 3,
          points: [
            { x: 0, y: 520 }, { x: 150, y: 440 }, { x: 300, y: 360 }, { x: 450, y: 440 },
            { x: 600, y: 520 }, { x: 750, y: 440 }, { x: 900, y: 360 },
            { x: 1050, y: 440 }, { x: 1200, y: 520 }, { x: 1280, y: 520 }
          ]
        }
      ],

      water: [{ cx: 640, cy: 130, r: 35 }, { cx: 640, cy: 590, r: 35 }],

      blockers: [
        { x: 520, y: 320, w: 60, h: 30 },
        { x: 700, y: 320, w: 60, h: 30 }
      ],

      removable: [
        { x: 380, y: 360, r: 20, cost: 400, name: 'Cooled Lava', blocksLOS: true },
        { x: 900, y: 360, r: 20, cost: 400, name: 'Volcanic Plug', blocksLOS: true },
        { x: 640, y: 360, r: 16, cost: 300, name: 'Ash Mound' }
      ],

      palette: {
        base: '#060404',
        grass: '#1e1414',
        grassAlt: '#281c18',
        path: '#5a3c28',
        pathEdge: '#3a2618',
        water: '#100808',
        rock: '#4a3828',
        accent: '#d06030'
      }
    },

    {
      key: 'serpent-coil',
      name: 'Serpent Coil',
      tier: 'expert',
      blurb: 'A single path that coils three times around a central tower — every loop is a kill zone.',
      trackWidth: 26,

      water: [{ cx: 640, cy: 360, r: 30 }],

      paths: [{
        smooth: 4,
        points: [
          { x: 0, y: 360 }, { x: 100, y: 200 }, { x: 300, y: 120 }, { x: 500, y: 120 },
          { x: 640, y: 200 }, { x: 640, y: 320 }, { x: 500, y: 400 }, { x: 300, y: 480 },
          { x: 100, y: 560 }, { x: 200, y: 640 }, { x: 400, y: 640 }, { x: 600, y: 560 },
          { x: 700, y: 440 }, { x: 800, y: 360 }, { x: 900, y: 440 }, { x: 1000, y: 560 },
          { x: 1100, y: 640 }, { x: 1200, y: 560 }, { x: 1200, y: 400 }, { x: 1100, y: 320 },
          { x: 900, y: 280 }, { x: 1100, y: 200 }, { x: 1200, y: 120 }, { x: 1280, y: 120 }
        ]
      }],

      blockers: [
        { x: 560, y: 320, w: 40, h: 40 },
        { x: 720, y: 320, w: 40, h: 40 }
      ],

      removable: [
        { x: 640, y: 360, r: 20, cost: 500, name: 'Serpent Statue', blocksLOS: true },
        { x: 400, y: 300, r: 16, cost: 350, name: 'Coiled Root' }
      ],

      palette: {
        base: '#040606',
        grass: '#161e14',
        grassAlt: '#1e2818',
        path: '#4a3c28',
        pathEdge: '#32261a',
        water: '#0a1010',
        rock: '#32302a',
        accent: '#a0d060'
      }
    }
  ]

  for (let i = 0; i < MAPS.length; i++) OP.Maps.define(MAPS[i])

  /* See the note in js/data/maps-advanced.js: the roster is derived from MAPS so
     a fifth map cannot be added without the suite's count assertion seeing it. */
  OP.MAP_ROSTERS = OP.MAP_ROSTERS || {}
  OP.MAP_ROSTERS.expert = MAPS.map(function (m) { return m.key })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
