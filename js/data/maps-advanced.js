;(function (OP) {
  'use strict'

  /* ============================================================================
     ADVANCED MAPS — four of them.

     The authored format, its validation rules and the placement-mask ORDER all
     live in js/core/maps.js. Read the comment block at the top of that file
     before touching anything here; nothing in this file re-documents it.

     What "advanced" means, concretely, and what
     tools/suites/map-roster-late.mjs holds these four to:

       · TWO OR THREE lanes. Balloons never change lane, so every lane is a
         separate defence problem and the ground between them is contested.
       · SIGNIFICANT WATER on every map. Not decoration: each water body has a
         legal spot for a water-only tower that is inside that tower's own base
         range of the road, which the suite measures rather than assumes.
       · SEVERAL line-of-sight blockers. Every authored blocker is ALSO listed in
         `blocked`, so a wall is never an invisible pane standing on buildable
         grass — the painter draws blockers in `palette.rock`, and a tower you
         could stand on top of a rock would read as a bug. The `walls` const in
         each map is spliced into both lists for exactly that reason.
       · MULTIPLE removable obstacles per map, each sitting on ground that
         clearing really frees. The margin is tested BEFORE the obstacle prompt
         (js/core/maps.js), so an obstacle straddling the road would answer "Too
         close to the path" and the player would never get the chance to pay.
       · CONSTRAINED building space: 42-52% of the field is buildable for a land
         tower, against 66%+ on beginner. Measured with Maps.buildableFraction.
       · TRACK LENGTH 3000-4500 units, measured as Maps.totalPathLength — the SUM
         across lanes, which is the only reading under which "two or three lanes"
         and "constrained building space" are simultaneously satisfiable: three
         lanes of 3000 each would put 66% of the field under road margin. The
         suite prints the total and the per-lane split in its message, and holds
         every lane to a 700-unit floor so "three lanes" cannot be one lane and
         two stubs.

     Every turn is drawn with an intermediate control point rather than a
     reversal at a single vertex. `smooth: 3` is a Catmull-Rom pass whose tangent
     at a control point is (next - prev) / 2, so a SHORT segment between two long
     ones gets a tangent far larger than the segment it spans and shoots past its
     own endpoint; define() rejects the result when it leaves the field. Keeping
     neighbouring segments within about 2x of each other is what avoids that, and
     the suite re-checks every lane's bounds() after smoothing.

     Four different shapes, not one shape repainted four times: a millpond with a
     lane either side of it, three parallel braids across a fen, a ridge crossed
     high and skirted low, and a river of pools with a bank lane on each side.
     ============================================================================ */

  /* ---------------------------------------------------------------- 1 of 4 --
     THORNWOOD WEIR — the head race runs along the top and drops down the east
     side; the tail race crawls the bottom and climbs out the same corner. The
     millpond owns the middle, the two sluice walls cut every sight line across
     it, and the old quarry takes the whole north-east corner. */

  const WEIR_WALLS = [
    { x: 612, y: 255, w: 24, h: 235 },   // west sluice wall
    { x: 906, y: 255, w: 24, h: 235 },   // east sluice wall
    { x: 330, y: 330, w: 200, h: 24 },   // the old hedge bank
    { x: 1000, y: 120, w: 22, h: 150 }   // the gate house
  ]

  /* ---------------------------------------------------------------- 2 of 4 --
     HOLLOWBROOK FEN — three brooks run the width of the fen in parallel. The
     dry ground is two horizontal strips, both of them cut up by peat pools and
     reed screens, so a tower covers one brook well or two brooks badly. */

  const FEN_WALLS = [
    { x: 520, y: 195, w: 24, h: 110 },
    { x: 1050, y: 185, w: 24, h: 130 },
    { x: 600, y: 435, w: 24, h: 140 },
    { x: 120, y: 435, w: 24, h: 140 }
  ]

  /* ---------------------------------------------------------------- 3 of 4 --
     STONEPINE RIDGE — one lane goes over the crest, one skirts the tarn below,
     and the scree band between them is both unbuildable and opaque, so ground
     that looks central is worth nothing to either lane. */

  const RIDGE_SCREE = { x: 480, y: 325, w: 460, h: 120 }
  const RIDGE_WALLS = [
    RIDGE_SCREE,
    { x: 190, y: 140, w: 120, h: 22 },
    { x: 1000, y: 300, w: 24, h: 140 },
    { x: 400, y: 470, w: 24, h: 120 }
  ]

  /* ---------------------------------------------------------------- 4 of 4 --
     OTTERFALL REACH — a chain of pools runs diagonally across the reach and a
     lane hugs each bank. The pools are the only ground the water towers get and
     they are also what stops a north-bank tower helping the south. */

  const REACH_WALLS = [
    { x: 360, y: 250, w: 120, h: 24 },
    { x: 640, y: 330, w: 120, h: 24 },
    { x: 900, y: 340, w: 24, h: 120 },
    { x: 180, y: 430, w: 24, h: 120 }
  ]

  const MAPS = [
    {
      key: 'thornwood-weir',
      name: 'Thornwood Weir',
      tier: 'advanced',
      blurb: 'Two mill lanes squeeze past a flooded weir, and the stone sluice walls take your sight lines with them.',
      trackWidth: 34,

      paths: [
        { name: 'Head Race',
          smooth: 3,
          points: [
            { x: 0, y: 95 }, { x: 150, y: 100 }, { x: 300, y: 150 }, { x: 390, y: 265 },
            { x: 510, y: 300 }, { x: 620, y: 215 }, { x: 700, y: 120 }, { x: 840, y: 120 },
            { x: 950, y: 200 }, { x: 985, y: 330 }, { x: 1000, y: 450 }, { x: 1090, y: 520 },
            { x: 1220, y: 505 }, { x: 1280, y: 500 }
          ] },
        { name: 'Tail Race',
          smooth: 3,
          points: [
            { x: 0, y: 655 }, { x: 160, y: 665 }, { x: 300, y: 640 }, { x: 400, y: 555 },
            { x: 470, y: 470 }, { x: 580, y: 520 }, { x: 700, y: 600 }, { x: 830, y: 640 },
            { x: 950, y: 600 }, { x: 1030, y: 505 }, { x: 1090, y: 410 }, { x: 1190, y: 455 },
            { x: 1250, y: 560 }, { x: 1280, y: 640 }
          ] }
      ],

      water: [
        { x: 620, y: 265, w: 310, h: 215 },   // the millpond
        { x: 110, y: 355, w: 230, h: 175 }    // the spill channel
      ],

      blocked: [
        { x: 1060, y: 30, w: 220, h: 330 },   // the worked-out quarry
        { x: 330, y: 25, w: 240, h: 90 },     // north crag
        { x: 30, y: 180, w: 110, h: 150 },    // west scarp
        { x: 100, y: 530, w: 200, h: 90 },    // spoil heap
        { x: 390, y: 570, w: 180, h: 110 }    // the old kiln floor
      ].concat(WEIR_WALLS),

      blockers: WEIR_WALLS,

      removable: [
        { x: 250, y: 230, r: 30, cost: 240, name: 'Fallen Alder', blocksLOS: true },
        { x: 790, y: 520, r: 32, cost: 280, name: 'Beaver Cairn', blocksLOS: true },
        { x: 1160, y: 620, r: 28, cost: 200, name: 'Bramble Knot' },
        { x: 60, y: 470, r: 26, cost: 180, name: 'Rotted Stump' }
      ],

      palette: {
        base: '#0b1210',
        grass: '#36512f',
        grassAlt: '#44653b',
        path: '#6b573c',
        pathEdge: '#463621',
        water: '#22414f',
        rock: '#5b5a52',
        accent: '#d0ac33',
        fog: '#0b1210'
      }
    },

    {
      key: 'hollowbrook-fen',
      name: 'Hollowbrook Fen',
      tier: 'advanced',
      blurb: 'Three brooks braid across a peat fen; the reed screens are taller than they look and the dry ground is thin.',
      trackWidth: 34,

      paths: [
        { name: 'North Brook',
          smooth: 3,
          points: [
            { x: 0, y: 90 }, { x: 180, y: 95 }, { x: 360, y: 140 }, { x: 520, y: 120 },
            { x: 700, y: 150 }, { x: 880, y: 120 }, { x: 1060, y: 160 }, { x: 1200, y: 150 },
            { x: 1280, y: 150 }
          ] },
        { name: 'Middle Brook',
          smooth: 3,
          points: [
            { x: 0, y: 370 }, { x: 170, y: 340 }, { x: 330, y: 395 }, { x: 500, y: 350 },
            { x: 660, y: 400 }, { x: 820, y: 345 }, { x: 980, y: 395 }, { x: 1140, y: 350 },
            { x: 1280, y: 375 }
          ] },
        { name: 'South Brook',
          smooth: 3,
          points: [
            { x: 0, y: 650 }, { x: 180, y: 640 }, { x: 350, y: 680 }, { x: 520, y: 635 },
            { x: 690, y: 675 }, { x: 860, y: 630 }, { x: 1030, y: 670 }, { x: 1200, y: 635 },
            { x: 1280, y: 650 }
          ] }
      ],

      water: [
        { x: 140, y: 190, w: 320, h: 120 },
        { x: 690, y: 188, w: 340, h: 124 },
        { x: 190, y: 440, w: 360, h: 125 },
        { x: 750, y: 443, w: 330, h: 122 }
      ],

      blocked: [
        { x: 0, y: 175, w: 110, h: 150 },
        { x: 1170, y: 430, w: 110, h: 165 },
        { x: 470, y: 195, w: 130, h: 110 },     // the cut-peat bank
        { cx: 430, cy: 590, r: 38 }             // a drowned stump
      ].concat(FEN_WALLS),

      blockers: FEN_WALLS,

      removable: [
        { x: 640, y: 250, r: 30, cost: 240, name: 'Sunken Hurdle', blocksLOS: true },
        { x: 1130, y: 480, r: 30, cost: 260, name: 'Peat Stack', blocksLOS: true },
        { x: 1120, y: 250, r: 26, cost: 180, name: 'Willow Snag' },
        { x: 680, y: 520, r: 28, cost: 220, name: 'Alder Root' }
      ],

      palette: {
        base: '#0c1310',
        grass: '#3a5533',
        grassAlt: '#4a6b3e',
        path: '#6f5c3d',
        pathEdge: '#4b3a22',
        water: '#2b4438',
        rock: '#575347',
        accent: '#cbb03a',
        fog: '#0c1310'
      }
    },

    {
      key: 'stonepine-ridge',
      name: 'Stonepine Ridge',
      tier: 'advanced',
      blurb: 'One lane climbs over the scree and one skirts the tarn below, and the ridge itself refuses to be built on.',
      trackWidth: 36,

      paths: [
        { name: 'The Crest',
          smooth: 3,
          points: [
            { x: 0, y: 300 }, { x: 150, y: 270 }, { x: 300, y: 200 }, { x: 430, y: 140 },
            { x: 560, y: 115 }, { x: 690, y: 165 }, { x: 745, y: 275 }, { x: 830, y: 180 },
            { x: 950, y: 110 }, { x: 1080, y: 140 }, { x: 1160, y: 240 }, { x: 1230, y: 150 },
            { x: 1280, y: 105 }
          ] },
        { name: 'The Tarn Path',
          smooth: 3,
          points: [
            { x: 0, y: 470 }, { x: 140, y: 510 }, { x: 290, y: 565 }, { x: 400, y: 660 },
            { x: 520, y: 600 }, { x: 640, y: 660 }, { x: 770, y: 620 }, { x: 880, y: 545 },
            { x: 960, y: 455 }, { x: 1060, y: 535 }, { x: 1160, y: 620 }, { x: 1250, y: 670 },
            { x: 1280, y: 700 }
          ] }
      ],

      water: [
        { cx: 300, cy: 400, r: 105 },          // the tarn
        { cx: 480, cy: 470, r: 90 },           // its overflow
        { x: 960, y: 235, w: 240, h: 150 }     // the high catch pool
      ],

      blocked: [
        { x: 0, y: 20, w: 280, h: 110 },
        { x: 820, y: 10, w: 220, h: 60 },
        { x: 0, y: 590, w: 130, h: 130 },
        { x: 1140, y: 330, w: 140, h: 150 },
        { x: 620, y: 555, w: 160, h: 70 }
      ].concat(RIDGE_WALLS),

      blockers: RIDGE_WALLS,

      removable: [
        { x: 540, y: 260, r: 32, cost: 300, name: 'Split Boulder', blocksLOS: true },
        { x: 950, y: 620, r: 30, cost: 260, name: 'Pine Deadfall', blocksLOS: true },
        { x: 170, y: 640, r: 28, cost: 200, name: 'Scree Pile' },
        { x: 1090, y: 60, r: 26, cost: 180, name: 'Cairn Stones' }
      ],

      palette: {
        base: '#0d1214',
        grass: '#334c36',
        grassAlt: '#3f5e41',
        path: '#6a5b46',
        pathEdge: '#453a28',
        water: '#274f66',
        rock: '#66655c',
        accent: '#c9a94a',
        fog: '#0d1214'
      }
    },

    {
      key: 'otterfall-reach',
      name: 'Otterfall Reach',
      tier: 'advanced',
      blurb: 'A chain of otter pools cuts the reach in half; both banks carry a lane and neither bank has room to spare.',
      trackWidth: 34,

      paths: [
        { name: 'North Bank',
          smooth: 3,
          points: [
            { x: 0, y: 90 }, { x: 160, y: 120 }, { x: 320, y: 110 }, { x: 470, y: 160 },
            { x: 600, y: 120 }, { x: 680, y: 230 }, { x: 760, y: 330 }, { x: 860, y: 300 },
            { x: 930, y: 240 }, { x: 1060, y: 200 }, { x: 1140, y: 140 }, { x: 1220, y: 200 },
            { x: 1250, y: 330 }, { x: 1280, y: 440 }
          ] },
        { name: 'South Bank',
          smooth: 3,
          points: [
            { x: 0, y: 420 }, { x: 120, y: 500 }, { x: 240, y: 560 }, { x: 300, y: 650 },
            { x: 390, y: 610 }, { x: 540, y: 640 }, { x: 690, y: 660 }, { x: 840, y: 640 },
            { x: 960, y: 580 }, { x: 1080, y: 620 }, { x: 1200, y: 680 }, { x: 1280, y: 700 }
          ] }
      ],

      water: [
        { cx: 150, cy: 270, r: 85 },
        { cx: 290, cy: 350, r: 90 },
        { cx: 430, cy: 430, r: 90 },
        { cx: 570, cy: 490, r: 85 },
        { cx: 720, cy: 500, r: 80 },
        { cx: 860, cy: 470, r: 75 },
        { cx: 1000, cy: 420, r: 72 },
        { cx: 1120, cy: 470, r: 68 }
      ],

      blocked: [
        { x: 0, y: 160, w: 100, h: 150 },
        { cx: 600, cy: 300, r: 65 },
        { x: 1180, y: 20, w: 100, h: 90 },
        { x: 0, y: 620, w: 100, h: 100 },
        { x: 660, y: 15, w: 300, h: 95 },
        { x: 390, y: 200, w: 230, h: 120 }
      ].concat(REACH_WALLS),

      blockers: REACH_WALLS,

      removable: [
        { x: 330, y: 180, r: 32, cost: 280, name: 'Driftwood Jam', blocksLOS: true },
        { x: 790, y: 390, r: 30, cost: 260, name: 'Otter Lodge', blocksLOS: true },
        { x: 1180, y: 540, r: 28, cost: 200, name: 'Shale Slab' },
        { x: 150, y: 620, r: 26, cost: 180, name: 'Reed Bale' }
      ],

      palette: {
        base: '#0a1412',
        grass: '#38563a',
        grassAlt: '#476b46',
        path: '#71603f',
        pathEdge: '#4d3d24',
        water: '#2d5f70',
        rock: '#575a55',
        accent: '#d6bb4e',
        fog: '#0a1412'
      }
    }
  ]

  for (let i = 0; i < MAPS.length; i++) OP.Maps.define(MAPS[i])

  /* The tier's roster, declared for the same reason OP.FAMILY_ROSTERS exists:
     other suites register throwaway maps into OP.MAPS, so a roster suite that
     derived its subject list from Maps.byTier() would audit test fixtures
     alongside the shipped tier. Derived from MAPS rather than typed out again,
     so adding a fifth map here cannot be silently skipped. */
  OP.MAP_ROSTERS = OP.MAP_ROSTERS || {}
  OP.MAP_ROSTERS.advanced = MAPS.map(function (m) { return m.key })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
