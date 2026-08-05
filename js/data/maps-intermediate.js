;(function (OP) {
  'use strict'

  /* ============================================================================
     INTERMEDIATE MAPS — four of them.

     Read the authored-format comment block at the top of js/core/maps.js first;
     everything below assumes it.

     What "intermediate" adds over the beginner tier, and what
     tools/suites/map-roster-early.mjs holds these four to:

       · One or two paths. Twinbrook Fork is the only two-laner: both lanes are
         authored as a short head plus ONE shared tail (FORK_TAIL below), because
         balloons never change path — a convergence is two point lists that end
         with the same geometry, not a graph. Both lanes therefore measure long
         individually while the painted road stays modest.
       · Water worth having. Every map here carries a region a water tower can
         actually stand in AND shoot from: each pond centre is more than
         `trackWidth` from every centreline, clear of `blocked`, and far enough
         from the field edge that Towers.canPlaceShape's footprint test passes.
         The suite checks each centre by calling Maps.canPlace directly, so a pond
         that is merely decorative fails.
       · A couple of line-of-sight blockers per map. Each one is declared in BOTH
         `blocked` and `blockers`: sight and building are separate systems here, so
         a rock that stops a shot has to be listed twice or it becomes an invisible
         wall standing on buildable grass. RECTANGLES ONLY — Targeting reads
         x/y/w/h with no shape dispatch, and a circle would silently disable LOS.
       · One or two removable obstacles. Each sits where a land tower would
         otherwise be legal, because the placement mask tests the path margin
         BEFORE the obstacle prompt: an obstacle straddling the road answers "Too
         close to the path" and the player never gets the chance to pay. Knotwood
         Crossing's Split Boulder also carries blocksLOS, so clearing it buys a
         sight line back as well as the ground.
       · Less open ground than the beginner tier — narrower margins do not do that
         on their own, so it comes from longer tracks, real water and real rock.
       · Track length 2600-4000 units per lane.

     Four distinct shapes: two lanes converging, a trail that crosses its own back,
     a coil that drains out of the bottom of a hollow, and three passes along a
     mill channel. Turns are rounded with an intermediate control point on every
     corner — `smooth: 4` overshoots its control polygon, and a hairpin near an
     edge pushes the built curve off the field, which define() rejects by name.
     ============================================================================ */

  /* The shared tail of Twinbrook Fork. Written once and appended to both lanes:
     the two brooks meet at (420,250) and everything after that point is one road
     walked by both lanes, which is what makes it a convergence rather than two
     unrelated tracks that happen to end at the same gate. Three passes, ~195
     units apart, so a tower dropped between two of them covers both. */
  const FORK_TAIL = [
    { x: 700, y: 240 }, { x: 1000, y: 260 }, { x: 1130, y: 340 }, { x: 1050, y: 430 },
    { x: 750, y: 450 }, { x: 450, y: 440 }, { x: 290, y: 470 }, { x: 230, y: 560 },
    { x: 330, y: 630 }, { x: 650, y: 650 }, { x: 1000, y: 640 }, { x: 1150, y: 670 },
    { x: 1280, y: 700 }
  ]

  const MAPS = [
    {
      key: 'twinbrook-fork',
      name: 'Twinbrook Fork',
      tier: 'intermediate',
      blurb: 'Two brooks come down out of the trees, meet under the alders, and run out as one.',
      trackWidth: 34,

      // The upper pool sits in the crook between the west lane and the coil below
      // it; the lower one in the gap between the first and second passes of the
      // shared tail, where a water tower reaches both.
      water: [{ cx: 175, cy: 320, r: 58 }, { cx: 620, cy: 348, r: 44 }],

      // Both listed in `blocked` as well: sight and building are separate systems.
      blocked: [{ x: 895, y: 325, w: 70, h: 70 }, { x: 60, y: 620, w: 80, h: 70 }],
      blockers: [{ x: 895, y: 325, w: 70, h: 70 }, { x: 60, y: 620, w: 80, h: 70 }],

      removable: [{ x: 560, y: 545, r: 28, cost: 220, name: 'Fallen Alder' }],

      paths: [
        // West lane: in off the left edge, down to the fork.
        { name: 'West Brook', smooth: 4, points: [
          { x: 0, y: 120 }, { x: 140, y: 130 }, { x: 300, y: 190 }, { x: 420, y: 250 }
        ].concat(FORK_TAIL) },
        // North lane: in off the top edge, into the same fork.
        { name: 'North Brook', smooth: 4, points: [
          { x: 250, y: 0 }, { x: 260, y: 120 }, { x: 340, y: 200 }, { x: 420, y: 250 }
        ].concat(FORK_TAIL) }
      ],

      palette: {
        base: '#0b120f',
        grass: '#2f4a33',
        grassAlt: '#3b5c3e',
        path: '#6a5742',
        pathEdge: '#45341f',
        water: '#2b5a70',
        rock: '#4f4f48',
        accent: '#c9a227',
        fog: '#0b120f'
      }
    },

    {
      key: 'knotwood-crossing',
      name: 'Knotwood Crossing',
      tier: 'intermediate',
      blurb: 'The trail ties itself in a knot and walks back across its own crossing.',
      trackWidth: 33,

      // One pool inside each loop of the knot. Both are enclosed by track on
      // several sides, which is exactly what makes them good ground.
      water: [{ cx: 965, cy: 395, r: 62 }, { cx: 320, cy: 435, r: 52 }],

      blocked: [{ x: 686, y: 145, w: 66, h: 64 }, { x: 590, y: 656, w: 90, h: 60 }],
      blockers: [{ x: 686, y: 145, w: 66, h: 64 }, { x: 590, y: 656, w: 90, h: 60 }],

      removable: [
        // blocksLOS: clearing this one restores a sight line across the south-east
        // corner as well as freeing the ground. Maps.build() derives the LOS
        // rectangle from x/y/r and drops it again the moment the obstacle is paid
        // for, so nothing here has to describe the blocker twice.
        { x: 1215, y: 640, r: 30, cost: 240, name: 'Split Boulder', blocksLOS: true },
        { x: 470, y: 90, r: 28, cost: 190, name: 'Bramble Thicket' }
      ],

      // In off the west edge, down through the crossing at (640,380), around the
      // east loop, back through the SAME crossing, around the west loop, and out
      // of the top edge — which crosses the entry leg one more time on the way.
      // A tower on the crossing sees four strands of track at once; a tower
      // anywhere else sees one.
      paths: [{
        smooth: 4,
        points: [
          { x: 0, y: 215 }, { x: 140, y: 200 }, { x: 340, y: 185 }, { x: 500, y: 275 },
          { x: 640, y: 380 }, { x: 810, y: 500 }, { x: 975, y: 615 }, { x: 1140, y: 540 },
          { x: 1185, y: 360 }, { x: 1060, y: 240 }, { x: 880, y: 255 }, { x: 760, y: 320 },
          { x: 640, y: 380 }, { x: 495, y: 505 }, { x: 345, y: 620 }, { x: 170, y: 520 },
          { x: 140, y: 340 }, { x: 230, y: 265 }, { x: 270, y: 135 }, { x: 280, y: 0 }
        ]
      }],

      palette: {
        base: '#0a0f0c',
        grass: '#2c4230',
        grassAlt: '#385238',
        path: '#63523c',
        pathEdge: '#3f3020',
        water: '#26485c',
        rock: '#4a4a44',
        accent: '#cdaa3a',
        fog: '#0a0f0c'
      }
    },

    {
      key: 'kettle-hollow',
      name: 'Kettle Hollow',
      tier: 'intermediate',
      blurb: 'The road coils down into the hollow and drains straight out of the bottom.',
      trackWidth: 32,

      // The kettle pond, in the floor of the hollow with the inner coil wrapped
      // around it. The longest track in the tier gets the most valuable water.
      water: [{ cx: 650, cy: 420, r: 60 }],

      blocked: [{ x: 55, y: 290, w: 80, h: 90 }, { x: 1190, y: 410, w: 80, h: 90 }],
      blockers: [{ x: 55, y: 290, w: 80, h: 90 }, { x: 1190, y: 410, w: 80, h: 90 }],

      removable: [
        { x: 170, y: 660, r: 30, cost: 200, name: 'Mossy Cairn' },
        { x: 1060, y: 90, r: 32, cost: 260, name: 'Split Ash Stump' }
      ],

      // An inward spiral: one full turn around the rim, a second turn inside it
      // ~140 units further in, then the drain — which cuts straight down through
      // the rim it just walked. Coils that close mean a tower on the west or
      // south side covers both turns, and the drain crossing is the one place a
      // single tower sees the very start and the very end of the run.
      paths: [{
        smooth: 4,
        points: [
          { x: 0, y: 150 }, { x: 140, y: 140 }, { x: 520, y: 130 }, { x: 900, y: 135 },
          { x: 1090, y: 175 }, { x: 1140, y: 300 }, { x: 1130, y: 470 }, { x: 1030, y: 570 },
          { x: 700, y: 600 }, { x: 400, y: 590 }, { x: 240, y: 520 }, { x: 215, y: 390 },
          { x: 330, y: 300 }, { x: 560, y: 275 }, { x: 830, y: 285 }, { x: 950, y: 350 },
          { x: 940, y: 450 }, { x: 860, y: 520 }, { x: 830, y: 650 }, { x: 820, y: 720 }
        ]
      }],

      palette: {
        base: '#0b100c',
        grass: '#33452c',
        grassAlt: '#405436',
        path: '#6b5740',
        pathEdge: '#453423',
        water: '#1f3f52',
        rock: '#52514a',
        accent: '#d4b24a',
        fog: '#0b100c'
      }
    },

    {
      key: 'millrace-bend',
      name: 'Millrace Bend',
      tier: 'intermediate',
      blurb: 'Three passes along the old mill channel, and the race is still deep enough to build on.',
      trackWidth: 32,

      // The race itself: a long rectangle threaded between the southern pass and
      // the middle one, roughly 120 from one and 200 from the other. It is the
      // only map in the tier where water is a line rather than a pool, so a water
      // tower can be positioned along it instead of dropped in the one spot.
      water: [{ x: 260, y: 380, w: 740, h: 90 }],

      // The mill's footings, at either end of the race.
      blocked: [{ x: 1010, y: 395, w: 90, h: 85 }, { x: 145, y: 375, w: 90, h: 95 }],
      blockers: [{ x: 1010, y: 395, w: 90, h: 85 }, { x: 145, y: 375, w: 90, h: 95 }],

      removable: [
        { x: 1210, y: 620, r: 30, cost: 210, name: 'Cracked Millstone' },
        { x: 700, y: 560, r: 30, cost: 240, name: 'Rotted Sluice Gate' }
      ],

      // East along the bottom, up the east side, west along the middle, up the
      // west side, and east again along the top — so the track doubles back
      // twice. The middle and top passes are ~185 apart and share their towers;
      // the southern pass is on its own, on the far side of the water.
      paths: [{
        smooth: 4,
        points: [
          { x: 0, y: 655 }, { x: 150, y: 660 }, { x: 520, y: 675 }, { x: 880, y: 670 },
          { x: 1080, y: 620 }, { x: 1180, y: 510 }, { x: 1175, y: 380 }, { x: 1080, y: 300 },
          { x: 880, y: 265 }, { x: 560, y: 255 }, { x: 300, y: 265 }, { x: 180, y: 215 },
          { x: 130, y: 120 }, { x: 240, y: 80 }, { x: 560, y: 70 }, { x: 900, y: 75 },
          { x: 1120, y: 110 }, { x: 1280, y: 150 }
        ]
      }],

      palette: {
        base: '#0e1310',
        grass: '#3a4f38',
        grassAlt: '#486045',
        path: '#776246',
        pathEdge: '#4d3b26',
        water: '#2d5f6e',
        rock: '#5b5a52',
        accent: '#d8bf5e',
        fog: '#0e1310'
      }
    }
  ]

  for (let i = 0; i < MAPS.length; i++) OP.Maps.define(MAPS[i])

  /* See the note in maps-beginner.js: declared rather than derived from
     Maps.byTier(), because other suites register throwaway 'intermediate' maps
     into the same registry, and built from MAPS so a fifth map cannot be added
     here without the roster suite noticing. */
  OP.MAP_ROSTERS = OP.MAP_ROSTERS || {}
  OP.MAP_ROSTERS.intermediate = MAPS.map(function (m) { return m.key })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
