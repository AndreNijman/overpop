;(function (OP) {
  'use strict'

  /* ============================================================================
     BEGINNER MAPS — four of them.

     The authored format, its validation rules and the placement-mask ordering all
     live in js/core/maps.js; read the comment block at the top of that file before
     touching anything here.

     What "beginner" means, concretely, and what tools/suites/map-roster-early.mjs
     holds these four to:

       · ONE path. No lane splits to reason about.
       · NO line-of-sight blockers at all. A beginner who cannot work out why a
         tower refuses to shoot has learned nothing except that the game is unfair,
         so `blockers` stays empty here — and because Maps.build() derives an LOS
         blocker from every `removable` with blocksLOS, these maps declare no
         removable obstacles either. The suite asserts `blockersAll` is empty,
         which is the form of that claim that cannot be gamed.
       · Generous open ground. A wide `trackWidth` (34-36) reads as a real road
         and keeps the buildable area honest: the margin is measured from the
         centreline and the tower footprint is deliberately NOT added at check
         time, so what you see here is exactly what the player gets.
       · Little or no water. Two of the four carry a single small pond so the
         water-placement towers are not dead weight across the whole tier; the
         other two are dry, and a dry built map still emits `water: []`, which
         forbids water towers everywhere. That is the documented behaviour, not
         an oversight.
       · Track length 2200-3200 units. Short enough to read at a glance, long
         enough that two or three towers can hold the early rounds.

     Every turn is authored with an intermediate control point rather than a
     reversal at a single vertex: `smooth: 4` is a centripetal Catmull-Rom pass
     that OVERSHOOTS its control polygon, and a hairpin pushes the built curve off
     the field — which define() rejects, naming the map. Rounded turns also give
     the terrain painter something that looks walked rather than folded.

     Each map is a different SHAPE, not a repainted one. In order: a long lazy S,
     a ring road around an open commons, four raked rows doubling back on each
     other, and a short zig-zag whose legs are too far apart for anything to cover
     two of them at once.
     ============================================================================ */

  const MAPS = [
    {
      key: 'fernway-hollow',
      name: 'Fernway Hollow',
      tier: 'beginner',
      blurb: 'One long lazy S through waist-high ferns — every corner is visible from the last.',
      trackWidth: 36,

      // A single S: right along the top, a wide sweep down the east side, back
      // west through the middle, then a short drop out of the bottom. No leg is
      // within reach of another, so coverage here is about placing few towers
      // well rather than stacking one crossroads.
      paths: [{
        smooth: 4,
        points: [
          { x: 0, y: 130 }, { x: 130, y: 130 }, { x: 560, y: 120 }, { x: 860, y: 170 },
          { x: 1140, y: 300 }, { x: 1100, y: 460 }, { x: 820, y: 540 }, { x: 520, y: 570 },
          { x: 300, y: 520 }, { x: 180, y: 600 }, { x: 200, y: 720 }
        ]
      }],

      palette: {
        base: '#0d1310',
        grass: '#35502f',
        grassAlt: '#436a3a',
        path: '#6f5a3e',
        pathEdge: '#4a3822',
        accent: '#d5b95a',
        fog: '#0d1310'
      }
    },

    {
      key: 'clover-commons',
      name: 'Clover Commons',
      tier: 'beginner',
      blurb: 'The old ring road runs right around the commons, and the whole middle is yours.',
      trackWidth: 36,

      // The duck pond, dead centre. Deliberately the only water in the tier that
      // sits inside a tower's reach of nothing at all: it is there so a water
      // tower has somewhere to stand, and it costs the player no ground they
      // wanted.
      water: [{ cx: 640, cy: 350, r: 62 }],

      // Three quarters of a ring, entered from the top and leaving by the west
      // edge, so the road closes past its own entrance. Everything inside the
      // ring can shoot outward in every direction.
      paths: [{
        smooth: 4,
        points: [
          { x: 280, y: 0 }, { x: 280, y: 110 }, { x: 250, y: 300 }, { x: 240, y: 470 },
          { x: 320, y: 590 }, { x: 470, y: 640 }, { x: 760, y: 650 }, { x: 1000, y: 620 },
          { x: 1120, y: 510 }, { x: 1160, y: 340 }, { x: 1150, y: 180 }, { x: 1050, y: 90 },
          { x: 880, y: 60 }, { x: 600, y: 55 }, { x: 330, y: 80 }, { x: 150, y: 190 },
          { x: 0, y: 230 }
        ]
      }],

      palette: {
        base: '#0e140f',
        grass: '#3f5c33',
        grassAlt: '#52713d',
        path: '#7a6647',
        pathEdge: '#513f26',
        water: '#2f5a6b',
        accent: '#e0c95f'
      }
    },

    {
      key: 'windrow-fields',
      name: 'Windrow Fields',
      tier: 'beginner',
      blurb: 'Four raked rows folded back on each other — build once here and you hit twice.',
      trackWidth: 34,

      // Columns 190 units apart. With a 34-unit margin either side that leaves a
      // ~120-unit buildable strip between two rows, and a tower in the middle of
      // it sits ~95 from both centrelines — inside the base range of most of the
      // roster. This is the map that teaches "place it between two legs", and the
      // suite proves the claim by counting legal spots that cover two stretches
      // of the track more than 600 units apart along it.
      paths: [{
        smooth: 4,
        points: [
          { x: 320, y: 0 }, { x: 320, y: 150 }, { x: 320, y: 555 }, { x: 415, y: 650 },
          { x: 510, y: 555 }, { x: 510, y: 150 }, { x: 605, y: 60 }, { x: 700, y: 150 },
          { x: 700, y: 555 }, { x: 795, y: 650 }, { x: 890, y: 555 }, { x: 890, y: 150 },
          { x: 960, y: 75 }, { x: 1150, y: 60 }, { x: 1280, y: 90 }
        ]
      }],

      palette: {
        base: '#12140e',
        grass: '#5a6134',
        grassAlt: '#6d7440',
        path: '#83694a',
        pathEdge: '#56412a',
        accent: '#dcc25c',
        fog: '#14150e'
      }
    },

    {
      key: 'harebell-dash',
      name: 'Harebell Dash',
      tier: 'beginner',
      blurb: 'The shortest run in the valley, and nothing here covers two legs at once.',
      trackWidth: 34,

      water: [{ cx: 480, cy: 170, r: 52 }],

      // The counterweight to Windrow Fields, and the reason both belong in the
      // same tier. A wide zig-zag: the legs splay far enough apart that no legal
      // spot reaches two distant stretches of track, so the answer is damage per
      // second rather than clever placement. Shortest track in the tier, too, so
      // there is less time to spend it.
      paths: [{
        smooth: 4,
        points: [
          { x: 0, y: 95 }, { x: 105, y: 120 }, { x: 295, y: 345 }, { x: 425, y: 580 },
          { x: 560, y: 680 }, { x: 705, y: 560 }, { x: 770, y: 330 }, { x: 840, y: 135 },
          { x: 930, y: 80 }, { x: 1058, y: 300 }, { x: 1140, y: 520 }, { x: 1205, y: 665 },
          { x: 1248, y: 720 }
        ]
      }],

      palette: {
        base: '#100e14',
        grass: '#384a35',
        grassAlt: '#4b6042',
        path: '#6b5a48',
        pathEdge: '#46382a',
        water: '#33566b',
        accent: '#c79ad2',
        fog: '#100e14'
      }
    }
  ]

  for (let i = 0; i < MAPS.length; i++) OP.Maps.define(MAPS[i])

  /* The tier's roster, declared for the same reason OP.FAMILY_ROSTERS exists:
     other suites register throwaway maps into OP.MAPS (several of them tiered
     'beginner'), so a roster suite that derived its subject list from
     Maps.byTier() would audit test fixtures alongside the shipped tier. Derived
     from MAPS rather than typed out again, so adding a fifth map here cannot be
     silently skipped — it lands in the roster and trips the count assertion. */
  OP.MAP_ROSTERS = OP.MAP_ROSTERS || {}
  OP.MAP_ROSTERS.beginner = MAPS.map(function (m) { return m.key })
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
