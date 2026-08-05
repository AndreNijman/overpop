;(function (OP) {
  'use strict'

  /* The standard 100-round table.

     A round is a list of spawn groups; the runner in js/core/rounds.js turns each
     group into `count` balloons of one tier, `spacing` seconds apart, starting
     `delay` seconds into the round (see Rounds.normalizeGroup for the shape and
     the defaults). Everything here is plain data — no closures, no tier objects,
     just string keys — so a mid-round save serialises and a round set can be
     swapped by name.

     Pacing intent, stated so a later tuning pass can tell design from accident:

       · Rounds 1-10 teach one tier at a time and never punish inattention.
       · 11-30 build the colour ladder to zebra and rainbow. Total RBE roughly
         doubles every eight rounds; the increments stay small enough that a
         player who under-builds gets a warning rather than a loss.
       · 24 and 25 introduce VEILED and REGEN, which is the point where a build
         without detection or burst damage stops working.
       · 31-39 are the ceramic ramp, deliberately held under 616 RBE so that
         round 40 — a single GOLIATH, arriving alone — is the largest single jump
         in the first half of the game.
       · 41-59 are the blimp-escort rounds. 52 adds WRAITH: fast, born veiled,
         and immune to sharp and explosive all at once. It is the difficulty
         spike of the middle game and it is meant to be felt.
       · 60-79 stack LEVIATHANs. PLATED starts at 70, sparingly, because it
         doubles layer HP without changing the RBE the HUD shows — a round that
         reads as ordinary and is not.
       · 80-97 are COLOSSUS rounds; 98 is the first OMEN; 100 is three of them
         with an escort, and is the hardest thing the table can send.

     RBE is never written down in this file. It is computed from the balloon tree
     by OP.Rounds.roundRBE / OP.roundSetRBE, and the suite asserts the curve is
     strictly increasing across all one hundred rounds. A hardcoded number here
     would be wrong the first time anyone tunes a tier's HP. */

  const P = OP.PROP
  const V = P.VEILED
  const RG = P.REGEN
  const PL = P.PLATED

  OP.ROUNDS_STANDARD = {

    /* ---------- 1-10 · one new tier at a time ---------- */

    1: { groups: [
      { tier: 'red', count: 10, spacing: 0.8 }
    ] },
    2: { groups: [
      { tier: 'red', count: 13, spacing: 0.6 }
    ] },
    3: { groups: [   // blue
      { tier: 'red', count: 9, spacing: 0.55 },
      { tier: 'blue', count: 3, spacing: 0.7, delay: 5 }
    ] },
    4: { groups: [
      { tier: 'red', count: 8, spacing: 0.5 },
      { tier: 'blue', count: 4, spacing: 0.6, delay: 4 }
    ] },
    5: { groups: [   // green
      { tier: 'red', count: 6, spacing: 0.5 },
      { tier: 'blue', count: 3, spacing: 0.6, delay: 3 },
      { tier: 'green', count: 2, spacing: 0.8, delay: 6 }
    ] },
    6: { groups: [
      { tier: 'red', count: 6, spacing: 0.45 },
      { tier: 'blue', count: 4, spacing: 0.55, delay: 3 },
      { tier: 'green', count: 2, spacing: 0.8, delay: 6.5 }
    ] },
    7: { groups: [   // yellow
      { tier: 'red', count: 4, spacing: 0.4 },
      { tier: 'blue', count: 3, spacing: 0.5, delay: 2.5 },
      { tier: 'green', count: 2, spacing: 0.6, delay: 5 },
      { tier: 'yellow', count: 2, spacing: 0.5, delay: 7.5 }
    ] },
    8: { groups: [
      { tier: 'red', count: 5, spacing: 0.4 },
      { tier: 'blue', count: 4, spacing: 0.5, delay: 2.5 },
      { tier: 'green', count: 2, spacing: 0.6, delay: 5 },
      { tier: 'yellow', count: 2, spacing: 0.5, delay: 7 }
    ] },
    9: { groups: [
      { tier: 'red', count: 4, spacing: 0.4 },
      { tier: 'blue', count: 4, spacing: 0.45, delay: 2.5 },
      { tier: 'green', count: 3, spacing: 0.55, delay: 5 },
      { tier: 'yellow', count: 2, spacing: 0.5, delay: 7.5 }
    ] },
    /* The first personality round: nothing but yellows, in two tight packs.
       Fast, harmless if you have coverage, embarrassing if you do not. */
    10: { groups: [
      { tier: 'yellow', count: 4, spacing: 0.15 },
      { tier: 'yellow', count: 4, spacing: 0.15, delay: 3.2 }
    ] },

    /* ---------- 11-22 · the colour ladder ---------- */

    11: { groups: [   // pink
      { tier: 'red', count: 4, spacing: 0.4 },
      { tier: 'blue', count: 3, spacing: 0.45, delay: 2 },
      { tier: 'green', count: 3, spacing: 0.5, delay: 4 },
      { tier: 'yellow', count: 2, spacing: 0.5, delay: 6 },
      { tier: 'pink', count: 2, spacing: 0.6, delay: 7.5 }
    ] },
    12: { groups: [
      { tier: 'blue', count: 4, spacing: 0.45 },
      { tier: 'green', count: 3, spacing: 0.5, delay: 2.5 },
      { tier: 'yellow', count: 3, spacing: 0.5, delay: 5 },
      { tier: 'pink', count: 2, spacing: 0.6, delay: 7 }
    ] },
    13: { groups: [
      { tier: 'blue', count: 4, spacing: 0.4 },
      { tier: 'green', count: 4, spacing: 0.45, delay: 2.5 },
      { tier: 'yellow', count: 2, spacing: 0.5, delay: 5 },
      { tier: 'pink', count: 3, spacing: 0.55, delay: 6.5 }
    ] },
    14: { groups: [
      { tier: 'red', count: 5, spacing: 0.35 },
      { tier: 'green', count: 5, spacing: 0.45, delay: 2.5 },
      { tier: 'yellow', count: 3, spacing: 0.45, delay: 5 },
      { tier: 'pink', count: 3, spacing: 0.55, delay: 7 }
    ] },
    15: { groups: [
      { tier: 'red', count: 2, spacing: 0.4 },
      { tier: 'green', count: 5, spacing: 0.4, delay: 2 },
      { tier: 'yellow', count: 4, spacing: 0.4, delay: 4.5 },
      { tier: 'pink', count: 4, spacing: 0.5, delay: 6.5 }
    ] },
    16: { groups: [
      { tier: 'blue', count: 4, spacing: 0.35 },
      { tier: 'green', count: 4, spacing: 0.4, delay: 2 },
      { tier: 'yellow', count: 4, spacing: 0.4, delay: 4.5 },
      { tier: 'pink', count: 5, spacing: 0.5, delay: 6.5 }
    ] },
    17: { groups: [   // black and white
      { tier: 'green', count: 4, spacing: 0.4 },
      { tier: 'yellow', count: 3, spacing: 0.4, delay: 2.5 },
      { tier: 'black', count: 2, spacing: 0.8, delay: 5 },
      { tier: 'white', count: 2, spacing: 0.8, delay: 7 }
    ] },
    18: { groups: [
      { tier: 'red', count: 2, spacing: 0.4 },
      { tier: 'yellow', count: 2, spacing: 0.4, delay: 1.5 },
      { tier: 'pink', count: 4, spacing: 0.45, delay: 3 },
      { tier: 'black', count: 2, spacing: 0.7, delay: 5.5 },
      { tier: 'white', count: 2, spacing: 0.7, delay: 7.5 }
    ] },
    19: { groups: [
      { tier: 'green', count: 3, spacing: 0.4 },
      { tier: 'pink', count: 3, spacing: 0.45, delay: 2.5 },
      { tier: 'black', count: 3, spacing: 0.6, delay: 5 },
      { tier: 'white', count: 2, spacing: 0.7, delay: 7.5 }
    ] },
    20: { groups: [   // lead
      { tier: 'red', count: 2, spacing: 0.4 },
      { tier: 'pink', count: 4, spacing: 0.45, delay: 1.5 },
      { tier: 'black', count: 1, spacing: 0.7, delay: 4 },
      { tier: 'white', count: 1, spacing: 0.7, delay: 5 },
      { tier: 'lead', count: 2, spacing: 1.2, delay: 6.5 }
    ] },
    21: { groups: [
      { tier: 'pink', count: 4, spacing: 0.4 },
      { tier: 'black', count: 1, spacing: 0.7, delay: 2.5 },
      { tier: 'white', count: 2, spacing: 0.7, delay: 4 },
      { tier: 'lead', count: 2, spacing: 1.2, delay: 6.5 }
    ] },
    22: { groups: [
      { tier: 'red', count: 5, spacing: 0.3 },
      { tier: 'pink', count: 3, spacing: 0.4, delay: 2 },
      { tier: 'black', count: 2, spacing: 0.6, delay: 4 },
      { tier: 'white', count: 2, spacing: 0.6, delay: 5.5 },
      { tier: 'lead', count: 2, spacing: 1.2, delay: 7 }
    ] },

    /* ---------- 23-31 · zebra, the properties, rainbow ---------- */

    23: { groups: [   // zebra
      { tier: 'pink', count: 2, spacing: 0.4 },
      { tier: 'black', count: 2, spacing: 0.6, delay: 1.5 },
      { tier: 'white', count: 2, spacing: 0.6, delay: 3.5 },
      { tier: 'lead', count: 1, spacing: 1, delay: 5.5 },
      { tier: 'zebra', count: 2, spacing: 1.2, delay: 7 }
    ] },
    /* VEILED arrives here. Two of these groups cannot be targeted at all by a
       tower without detection, which is the whole lesson. */
    24: { groups: [
      { tier: 'red', count: 2, spacing: 0.4 },
      { tier: 'pink', count: 4, spacing: 0.45, delay: 1.5, props: V },
      { tier: 'black', count: 2, spacing: 0.7, delay: 4, props: V },
      { tier: 'lead', count: 2, spacing: 1.1, delay: 6 },
      { tier: 'zebra', count: 2, spacing: 1.2, delay: 8 }
    ] },
    /* REGEN arrives here. Chip damage that used to be enough now loses ground. */
    25: { groups: [
      { tier: 'red', count: 6, spacing: 0.3 },
      { tier: 'green', count: 4, spacing: 0.4, delay: 2, props: RG },
      { tier: 'pink', count: 4, spacing: 0.45, delay: 4 },
      { tier: 'white', count: 2, spacing: 0.7, delay: 6, props: RG },
      { tier: 'lead', count: 2, spacing: 1.1, delay: 7.5 },
      { tier: 'zebra', count: 2, spacing: 1.2, delay: 9.5 }
    ] },
    26: { groups: [
      { tier: 'pink', count: 3, spacing: 0.4 },
      { tier: 'black', count: 2, spacing: 0.6, delay: 2 },
      { tier: 'white', count: 2, spacing: 0.6, delay: 3.5 },
      { tier: 'lead', count: 2, spacing: 1.1, delay: 5.5 },
      { tier: 'zebra', count: 3, spacing: 1.1, delay: 7.5 }
    ] },
    27: { groups: [
      { tier: 'pink', count: 4, spacing: 0.4 },
      { tier: 'black', count: 3, spacing: 0.6, delay: 2, props: V },
      { tier: 'white', count: 2, spacing: 0.6, delay: 4.5 },
      { tier: 'lead', count: 2, spacing: 1.1, delay: 6 },
      { tier: 'zebra', count: 3, spacing: 1.1, delay: 8 }
    ] },
    28: { groups: [   // rainbow
      { tier: 'black', count: 2, spacing: 0.6 },
      { tier: 'lead', count: 2, spacing: 1, delay: 2 },
      { tier: 'zebra', count: 2, spacing: 1.1, delay: 4.5 },
      { tier: 'rainbow', count: 2, spacing: 1.4, delay: 7 }
    ] },
    29: { groups: [
      { tier: 'yellow', count: 5, spacing: 0.3 },
      { tier: 'black', count: 2, spacing: 0.6, delay: 2 },
      { tier: 'lead', count: 2, spacing: 1, delay: 4 },
      { tier: 'zebra', count: 2, spacing: 1.1, delay: 6 },
      { tier: 'rainbow', count: 2, spacing: 1.4, delay: 8.5 }
    ] },
    30: { groups: [
      { tier: 'black', count: 2, spacing: 0.6 },
      { tier: 'lead', count: 2, spacing: 1, delay: 2 },
      { tier: 'zebra', count: 2, spacing: 1.1, delay: 4, props: V },
      { tier: 'rainbow', count: 3, spacing: 1.3, delay: 6.5 }
    ] },
    31: { groups: [
      { tier: 'white', count: 2, spacing: 0.6, props: RG },
      { tier: 'lead', count: 2, spacing: 1, delay: 2 },
      { tier: 'zebra', count: 3, spacing: 1, delay: 4 },
      { tier: 'rainbow', count: 3, spacing: 1.3, delay: 7 }
    ] },

    /* ---------- 32-39 · the ceramic ramp, held under one GOLIATH ---------- */

    32: { groups: [   // ceramic
      { tier: 'red', count: 4, spacing: 0.3 },
      { tier: 'zebra', count: 2, spacing: 1, delay: 2 },
      { tier: 'rainbow', count: 1, spacing: 1.2, delay: 4.5 },
      { tier: 'ceramic', count: 2, spacing: 1.6, delay: 6 }
    ] },
    33: { groups: [
      { tier: 'red', count: 6, spacing: 0.3 },
      { tier: 'zebra', count: 1, spacing: 1, delay: 2 },
      { tier: 'rainbow', count: 2, spacing: 1.2, delay: 4 },
      { tier: 'ceramic', count: 2, spacing: 1.6, delay: 6.5 }
    ] },
    34: { groups: [
      { tier: 'pink', count: 3, spacing: 0.35 },
      { tier: 'lead', count: 1, spacing: 1, delay: 2 },
      { tier: 'zebra', count: 1, spacing: 1, delay: 3.5 },
      { tier: 'rainbow', count: 2, spacing: 1.2, delay: 5 },
      { tier: 'ceramic', count: 2, spacing: 1.6, delay: 7.5 }
    ] },
    35: { groups: [   // purple — nothing that glows will touch it
      { tier: 'purple', count: 6, spacing: 0.5 },
      { tier: 'zebra', count: 1, spacing: 1, delay: 4 },
      { tier: 'rainbow', count: 2, spacing: 1.2, delay: 5.5 },
      { tier: 'ceramic', count: 2, spacing: 1.6, delay: 8 }
    ] },
    36: { groups: [
      { tier: 'purple', count: 4, spacing: 0.5 },
      { tier: 'zebra', count: 1, spacing: 1, delay: 3 },
      { tier: 'rainbow', count: 1, spacing: 1.2, delay: 4.5 },
      { tier: 'ceramic', count: 3, spacing: 1.4, delay: 6 }
    ] },
    37: { groups: [
      { tier: 'purple', count: 4, spacing: 0.5, props: V },
      { tier: 'pink', count: 4, spacing: 0.4, delay: 3 },
      { tier: 'rainbow', count: 2, spacing: 1.2, delay: 5 },
      { tier: 'ceramic', count: 3, spacing: 1.4, delay: 7 }
    ] },
    38: { groups: [
      { tier: 'purple', count: 4, spacing: 0.5 },
      { tier: 'rainbow', count: 1, spacing: 1.2, delay: 3 },
      { tier: 'ceramic', count: 4, spacing: 1.3, delay: 5 }
    ] },
    39: { groups: [
      { tier: 'purple', count: 6, spacing: 0.45, props: RG },
      { tier: 'zebra', count: 1, spacing: 1, delay: 3.5 },
      { tier: 'rainbow', count: 1, spacing: 1.2, delay: 5 },
      { tier: 'ceramic', count: 4, spacing: 1.3, delay: 6.5 }
    ] },

    /* One GOLIATH. Nothing else, on any path. Either the board can chew through
       two hundred layers of hull before it crosses, or it cannot. */
    40: { groups: [
      { tier: 'goliath', count: 1, delay: 4 }
    ] },

    /* ---------- 41-51 · blimps with escorts ---------- */

    41: { groups: [
      { tier: 'rainbow', count: 2, spacing: 1.2 },
      { tier: 'goliath', count: 1, delay: 5 }
    ] },
    42: { groups: [
      { tier: 'zebra', count: 1, spacing: 1 },
      { tier: 'rainbow', count: 1, spacing: 1.2, delay: 2 },
      { tier: 'ceramic', count: 1, spacing: 1.4, delay: 4 },
      { tier: 'goliath', count: 1, delay: 6 }
    ] },
    43: { groups: [
      { tier: 'pink', count: 4, spacing: 0.35 },
      { tier: 'zebra', count: 2, spacing: 1, delay: 2 },
      { tier: 'ceramic', count: 2, spacing: 1.4, delay: 4.5 },
      { tier: 'goliath', count: 1, delay: 7 }
    ] },
    44: { groups: [
      { tier: 'zebra', count: 1, spacing: 1 },
      { tier: 'rainbow', count: 1, spacing: 1.2, delay: 2 },
      { tier: 'ceramic', count: 3, spacing: 1.3, delay: 3.5 },
      { tier: 'goliath', count: 1, delay: 7.5 }
    ] },
    45: { groups: [
      { tier: 'rainbow', count: 2, spacing: 1.2, props: V },
      { tier: 'ceramic', count: 4, spacing: 1.2, delay: 3 },
      { tier: 'goliath', count: 1, delay: 8 }
    ] },
    46: { groups: [
      { tier: 'rainbow', count: 1, spacing: 1.2 },
      { tier: 'goliath', count: 2, spacing: 3.5, delay: 4 }
    ] },
    47: { groups: [
      { tier: 'ceramic', count: 2, spacing: 1.4 },
      { tier: 'goliath', count: 2, spacing: 3.5, delay: 4.5 }
    ] },
    /* The ceramic wall: fifteen shells on one tick, after a pause long enough to
       watch them come. A board that relies on single-target damage stops here. */
    48: { groups: [
      { tier: 'zebra', count: 3, spacing: 0.8 },
      { tier: 'ceramic', count: 15, spacing: 0, delay: 4 }
    ] },
    49: { groups: [
      { tier: 'rainbow', count: 2, spacing: 1.2 },
      { tier: 'ceramic', count: 5, spacing: 1, delay: 2.5 },
      { tier: 'goliath', count: 2, spacing: 3.5, delay: 8 }
    ] },
    50: { groups: [
      { tier: 'ceramic', count: 2, spacing: 1.4 },
      { tier: 'goliath', count: 3, spacing: 3, delay: 4 }
    ] },
    51: { groups: [
      { tier: 'rainbow', count: 2, spacing: 1.2, props: RG },
      { tier: 'ceramic', count: 4, spacing: 1.1, delay: 2.5 },
      { tier: 'goliath', count: 3, spacing: 3, delay: 8 }
    ] },

    /* WRAITH. Born veiled, nearly three times a red balloon's speed, and it
       ignores sharp and explosive damage. If the board has no detection and no
       damage type outside those two, this round ends the run. */
    52: { groups: [
      { tier: 'rainbow', count: 2, spacing: 1.2 },
      { tier: 'ceramic', count: 5, spacing: 1, delay: 2.5 },
      { tier: 'goliath', count: 2, spacing: 3, delay: 8 },
      { tier: 'wraith', count: 1, delay: 14 }
    ] },
    53: { groups: [
      { tier: 'zebra', count: 4, spacing: 0.7 },
      { tier: 'rainbow', count: 2, spacing: 1.2, delay: 3 },
      { tier: 'ceramic', count: 7, spacing: 0.9, delay: 5 },
      { tier: 'goliath', count: 2, spacing: 3, delay: 11 },
      { tier: 'wraith', count: 1, delay: 16 }
    ] },
    54: { groups: [
      { tier: 'rainbow', count: 3, spacing: 1.1 },
      { tier: 'ceramic', count: 5, spacing: 1, delay: 3 },
      { tier: 'goliath', count: 3, spacing: 2.5, delay: 8 },
      { tier: 'wraith', count: 1, delay: 15 }
    ] },
    /* The camo round. Almost nothing here can be targeted without detection. */
    55: { groups: [
      { tier: 'rainbow', count: 6, spacing: 0.6, props: V },
      { tier: 'ceramic', count: 12, spacing: 0.5, delay: 4, props: V },
      { tier: 'wraith', count: 2, spacing: 3, delay: 11 },
      { tier: 'goliath', count: 1, delay: 17 }
    ] },
    56: { groups: [
      { tier: 'zebra', count: 6, spacing: 0.6 },
      { tier: 'rainbow', count: 4, spacing: 0.9, delay: 3 },
      { tier: 'ceramic', count: 10, spacing: 0.6, delay: 6 },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 12 },
      { tier: 'wraith', count: 2, spacing: 3, delay: 16 }
    ] },
    57: { groups: [
      { tier: 'rainbow', count: 4, spacing: 0.9, props: RG },
      { tier: 'ceramic', count: 10, spacing: 0.6, delay: 4 },
      { tier: 'goliath', count: 3, spacing: 2.5, delay: 10 },
      { tier: 'wraith', count: 2, spacing: 3, delay: 16 }
    ] },
    58: { groups: [
      { tier: 'rainbow', count: 6, spacing: 0.8 },
      { tier: 'ceramic', count: 10, spacing: 0.6, delay: 4 },
      { tier: 'goliath', count: 4, spacing: 2.2, delay: 10 },
      { tier: 'wraith', count: 2, spacing: 3, delay: 17 }
    ] },
    59: { groups: [
      { tier: 'rainbow', count: 4, spacing: 0.9, props: V },
      { tier: 'ceramic', count: 10, spacing: 0.6, delay: 4 },
      { tier: 'goliath', count: 4, spacing: 2.2, delay: 10 },
      { tier: 'wraith', count: 3, spacing: 2.8, delay: 17 }
    ] },

    /* ---------- 60-69 · LEVIATHAN ---------- */

    /* LEVIATHAN: slow, enormous, and four GOLIATHs deep. Slowing it further is
       almost free — killing it is not. */
    60: { groups: [
      { tier: 'rainbow', count: 4, spacing: 0.9 },
      { tier: 'ceramic', count: 8, spacing: 0.6, delay: 3 },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 8 },
      { tier: 'wraith', count: 2, spacing: 3, delay: 13 },
      { tier: 'leviathan', count: 1, delay: 20 }
    ] },
    61: { groups: [
      { tier: 'rainbow', count: 6, spacing: 0.8 },
      { tier: 'ceramic', count: 10, spacing: 0.6, delay: 4 },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 10 },
      { tier: 'wraith', count: 2, spacing: 3, delay: 15 },
      { tier: 'leviathan', count: 1, delay: 21 }
    ] },
    62: { groups: [
      { tier: 'rainbow', count: 6, spacing: 0.8, props: RG },
      { tier: 'ceramic', count: 8, spacing: 0.6, delay: 4 },
      { tier: 'goliath', count: 1, delay: 9 },
      { tier: 'wraith', count: 1, delay: 13 },
      { tier: 'leviathan', count: 2, spacing: 5, delay: 18 }
    ] },
    63: { groups: [
      { tier: 'zebra', count: 8, spacing: 0.5 },
      { tier: 'rainbow', count: 4, spacing: 0.9, delay: 4 },
      { tier: 'ceramic', count: 8, spacing: 0.6, delay: 7 },
      { tier: 'goliath', count: 1, delay: 12 },
      { tier: 'wraith', count: 2, spacing: 2.8, delay: 15 },
      { tier: 'leviathan', count: 2, spacing: 5, delay: 21 }
    ] },
    64: { groups: [
      { tier: 'rainbow', count: 6, spacing: 0.8 },
      { tier: 'ceramic', count: 10, spacing: 0.6, delay: 4 },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 10 },
      { tier: 'wraith', count: 2, spacing: 2.8, delay: 16 },
      { tier: 'leviathan', count: 2, spacing: 5, delay: 22 }
    ] },
    65: { groups: [
      { tier: 'rainbow', count: 4, spacing: 0.9, props: V },
      { tier: 'ceramic', count: 10, spacing: 0.6, delay: 4 },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 10 },
      { tier: 'wraith', count: 1, delay: 15 },
      { tier: 'leviathan', count: 3, spacing: 4.5, delay: 19 }
    ] },
    66: { groups: [
      { tier: 'ceramic', count: 12, spacing: 0.55 },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 8 },
      { tier: 'wraith', count: 2, spacing: 2.8, delay: 14 },
      { tier: 'leviathan', count: 3, spacing: 4.5, delay: 20 }
    ] },
    67: { groups: [
      { tier: 'ceramic', count: 10, spacing: 0.55, props: RG },
      { tier: 'goliath', count: 1, delay: 8 },
      { tier: 'wraith', count: 2, spacing: 2.8, delay: 12 },
      { tier: 'leviathan', count: 4, spacing: 4, delay: 18 }
    ] },
    68: { groups: [
      { tier: 'ceramic', count: 12, spacing: 0.55 },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 8 },
      { tier: 'wraith', count: 3, spacing: 2.5, delay: 13 },
      { tier: 'leviathan', count: 4, spacing: 4, delay: 20 }
    ] },
    69: { groups: [
      { tier: 'ceramic', count: 10, spacing: 0.55, props: V },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 8 },
      { tier: 'wraith', count: 2, spacing: 2.8, delay: 13 },
      { tier: 'leviathan', count: 5, spacing: 3.5, delay: 19 }
    ] },

    /* ---------- 70-79 · PLATED, and LEVIATHANs in numbers ---------- */

    /* PLATED starts here. It doubles every layer's HP and changes nothing the
       HUD shows, so this round reads exactly like round 69 and is not. */
    70: { groups: [
      { tier: 'ceramic', count: 14, spacing: 0.5, props: PL },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 9 },
      { tier: 'wraith', count: 3, spacing: 2.5, delay: 14 },
      { tier: 'leviathan', count: 5, spacing: 3.5, delay: 20 }
    ] },
    71: { groups: [
      { tier: 'ceramic', count: 12, spacing: 0.5 },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 8 },
      { tier: 'wraith', count: 3, spacing: 2.5, delay: 13 },
      { tier: 'leviathan', count: 6, spacing: 3.2, delay: 19 }
    ] },
    72: { groups: [
      { tier: 'ceramic', count: 12, spacing: 0.5, props: V },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 8 },
      { tier: 'wraith', count: 2, spacing: 2.8, delay: 13 },
      { tier: 'leviathan', count: 7, spacing: 3, delay: 18 }
    ] },
    73: { groups: [
      { tier: 'ceramic', count: 12, spacing: 0.5, props: PL },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 8 },
      { tier: 'wraith', count: 3, spacing: 2.5, delay: 13 },
      { tier: 'leviathan', count: 8, spacing: 2.8, delay: 18 }
    ] },
    74: { groups: [
      { tier: 'ceramic', count: 12, spacing: 0.5, props: RG },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 8 },
      { tier: 'wraith', count: 3, spacing: 2.5, delay: 13 },
      { tier: 'leviathan', count: 9, spacing: 2.6, delay: 18 }
    ] },
    75: { groups: [
      { tier: 'ceramic', count: 12, spacing: 0.5 },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 8 },
      { tier: 'wraith', count: 4, spacing: 2.4, delay: 13 },
      { tier: 'leviathan', count: 10, spacing: 2.4, delay: 18 }
    ] },
    76: { groups: [
      { tier: 'ceramic', count: 14, spacing: 0.5, props: PL },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 9 },
      { tier: 'wraith', count: 4, spacing: 2.4, delay: 14 },
      { tier: 'leviathan', count: 11, spacing: 2.2, delay: 19 }
    ] },
    77: { groups: [
      { tier: 'ceramic', count: 14, spacing: 0.5, props: V },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 9 },
      { tier: 'wraith', count: 5, spacing: 2.2, delay: 14 },
      { tier: 'leviathan', count: 12, spacing: 2.1, delay: 19 }
    ] },
    78: { groups: [
      { tier: 'ceramic', count: 14, spacing: 0.5 },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 9 },
      { tier: 'wraith', count: 4, spacing: 2.4, delay: 14 },
      { tier: 'leviathan', count: 14, spacing: 1.9, delay: 19 }
    ] },
    79: { groups: [
      { tier: 'ceramic', count: 16, spacing: 0.45, props: PL },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 5, spacing: 2.2, delay: 14 },
      { tier: 'leviathan', count: 15, spacing: 1.8, delay: 19 }
    ] },

    /* ---------- 80-97 · COLOSSUS ---------- */

    /* COLOSSUS: four thousand hits of hull, then four LEVIATHANs. */
    80: { groups: [
      { tier: 'ceramic', count: 16, spacing: 0.45 },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 5, spacing: 2.2, delay: 14 },
      { tier: 'leviathan', count: 12, spacing: 2, delay: 19 },
      { tier: 'colossus', count: 1, delay: 30 }
    ] },
    81: { groups: [
      { tier: 'ceramic', count: 16, spacing: 0.45, props: V },
      { tier: 'goliath', count: 2, spacing: 2.5, delay: 9 },
      { tier: 'wraith', count: 4, spacing: 2.4, delay: 13 },
      { tier: 'leviathan', count: 9, spacing: 2.4, delay: 18 },
      { tier: 'colossus', count: 2, spacing: 6, delay: 28 }
    ] },
    82: { groups: [
      { tier: 'ceramic', count: 16, spacing: 0.45, props: RG },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 9 },
      { tier: 'wraith', count: 5, spacing: 2.2, delay: 14 },
      { tier: 'leviathan', count: 11, spacing: 2.2, delay: 19 },
      { tier: 'colossus', count: 2, spacing: 6, delay: 30 }
    ] },
    83: { groups: [
      { tier: 'ceramic', count: 16, spacing: 0.45, props: PL },
      { tier: 'goliath', count: 3, spacing: 2.2, delay: 9 },
      { tier: 'wraith', count: 4, spacing: 2.4, delay: 14 },
      { tier: 'leviathan', count: 7, spacing: 2.6, delay: 19 },
      { tier: 'colossus', count: 3, spacing: 5.5, delay: 28 }
    ] },
    84: { groups: [
      { tier: 'ceramic', count: 18, spacing: 0.45 },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 5, spacing: 2.2, delay: 14 },
      { tier: 'leviathan', count: 9, spacing: 2.4, delay: 19 },
      { tier: 'colossus', count: 3, spacing: 5.5, delay: 30 }
    ] },
    85: { groups: [
      { tier: 'ceramic', count: 18, spacing: 0.45, props: V },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 5, spacing: 2.2, delay: 14 },
      { tier: 'leviathan', count: 7, spacing: 2.6, delay: 19 },
      { tier: 'colossus', count: 4, spacing: 5, delay: 28 }
    ] },
    86: { groups: [
      { tier: 'ceramic', count: 20, spacing: 0.4 },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 6, spacing: 2, delay: 14 },
      { tier: 'leviathan', count: 9, spacing: 2.4, delay: 19 },
      { tier: 'colossus', count: 4, spacing: 5, delay: 30 }
    ] },
    87: { groups: [
      { tier: 'ceramic', count: 20, spacing: 0.4, props: PL },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 5, spacing: 2.2, delay: 14 },
      { tier: 'leviathan', count: 6, spacing: 2.8, delay: 19 },
      { tier: 'colossus', count: 5, spacing: 4.5, delay: 28 }
    ] },
    88: { groups: [
      { tier: 'ceramic', count: 20, spacing: 0.4, props: RG },
      { tier: 'goliath', count: 5, spacing: 1.8, delay: 9 },
      { tier: 'wraith', count: 6, spacing: 2, delay: 14 },
      { tier: 'leviathan', count: 8, spacing: 2.5, delay: 19 },
      { tier: 'colossus', count: 5, spacing: 4.5, delay: 30 }
    ] },
    89: { groups: [
      { tier: 'ceramic', count: 20, spacing: 0.4, props: V },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 6, spacing: 2, delay: 14 },
      { tier: 'leviathan', count: 7, spacing: 2.6, delay: 19 },
      { tier: 'colossus', count: 6, spacing: 4, delay: 28 }
    ] },
    90: { groups: [
      { tier: 'ceramic', count: 22, spacing: 0.4 },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 6, spacing: 2, delay: 14 },
      { tier: 'leviathan', count: 6, spacing: 2.8, delay: 19 },
      { tier: 'colossus', count: 7, spacing: 4, delay: 30 }
    ] },
    91: { groups: [
      { tier: 'ceramic', count: 22, spacing: 0.4, props: PL },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 7, spacing: 1.9, delay: 14 },
      { tier: 'leviathan', count: 5, spacing: 3, delay: 19 },
      { tier: 'colossus', count: 8, spacing: 3.6, delay: 28 }
    ] },
    92: { groups: [
      { tier: 'ceramic', count: 24, spacing: 0.4, props: V },
      { tier: 'goliath', count: 4, spacing: 2, delay: 9 },
      { tier: 'wraith', count: 7, spacing: 1.9, delay: 14 },
      { tier: 'leviathan', count: 5, spacing: 3, delay: 19 },
      { tier: 'colossus', count: 9, spacing: 3.4, delay: 30 }
    ] },
    93: { groups: [
      { tier: 'ceramic', count: 24, spacing: 0.4, props: RG },
      { tier: 'goliath', count: 5, spacing: 1.8, delay: 9 },
      { tier: 'wraith', count: 8, spacing: 1.8, delay: 14 },
      { tier: 'leviathan', count: 5, spacing: 3, delay: 19 },
      { tier: 'colossus', count: 10, spacing: 3.2, delay: 30 }
    ] },
    94: { groups: [
      { tier: 'ceramic', count: 26, spacing: 0.35 },
      { tier: 'goliath', count: 5, spacing: 1.8, delay: 9 },
      { tier: 'wraith', count: 8, spacing: 1.8, delay: 14 },
      { tier: 'leviathan', count: 5, spacing: 3, delay: 19 },
      { tier: 'colossus', count: 11, spacing: 3, delay: 30 }
    ] },
    95: { groups: [
      { tier: 'ceramic', count: 26, spacing: 0.35, props: PL },
      { tier: 'goliath', count: 6, spacing: 1.7, delay: 9 },
      { tier: 'wraith', count: 8, spacing: 1.8, delay: 14 },
      { tier: 'leviathan', count: 5, spacing: 3, delay: 19 },
      { tier: 'colossus', count: 12, spacing: 2.8, delay: 30 }
    ] },
    96: { groups: [
      { tier: 'ceramic', count: 28, spacing: 0.35, props: V },
      { tier: 'goliath', count: 6, spacing: 1.7, delay: 9 },
      { tier: 'wraith', count: 9, spacing: 1.7, delay: 14 },
      { tier: 'leviathan', count: 5, spacing: 3, delay: 19 },
      { tier: 'colossus', count: 13, spacing: 2.6, delay: 30 }
    ] },
    97: { groups: [
      { tier: 'ceramic', count: 30, spacing: 0.35, props: RG },
      { tier: 'goliath', count: 6, spacing: 1.7, delay: 9 },
      { tier: 'wraith', count: 9, spacing: 1.7, delay: 14 },
      { tier: 'leviathan', count: 6, spacing: 2.8, delay: 19 },
      { tier: 'colossus', count: 14, spacing: 2.5, delay: 30 }
    ] },

    /* ---------- 98-100 · OMEN ---------- */

    /* The first OMEN. Twenty thousand hits of hull, two COLOSSUS and three
       WRAITHs inside it, and immune to instant-kill effects — no single ability
       deletes this. */
    98: { groups: [
      { tier: 'ceramic', count: 30, spacing: 0.35, props: PL },
      { tier: 'goliath', count: 6, spacing: 1.7, delay: 9 },
      { tier: 'wraith', count: 10, spacing: 1.6, delay: 14 },
      { tier: 'leviathan', count: 8, spacing: 2.4, delay: 19 },
      { tier: 'colossus', count: 11, spacing: 2.8, delay: 28 },
      { tier: 'omen', count: 1, delay: 45 }
    ] },
    99: { groups: [
      { tier: 'ceramic', count: 32, spacing: 0.35, props: V },
      { tier: 'goliath', count: 6, spacing: 1.7, delay: 9 },
      { tier: 'wraith', count: 10, spacing: 1.6, delay: 14 },
      { tier: 'leviathan', count: 9, spacing: 2.4, delay: 19 },
      { tier: 'colossus', count: 10, spacing: 2.8, delay: 28 },
      { tier: 'omen', count: 2, spacing: 9, delay: 44 }
    ] },
    /* The last thing the track sends: three OMENs behind nine COLOSSUS, with
       everything else the table has taught in front of them. */
    100: { groups: [
      { tier: 'rainbow', count: 24, spacing: 0.3 },
      { tier: 'ceramic', count: 40, spacing: 0.35, delay: 4, props: PL },
      { tier: 'wraith', count: 12, spacing: 1.5, delay: 14 },
      { tier: 'leviathan', count: 10, spacing: 2.2, delay: 20 },
      { tier: 'colossus', count: 9, spacing: 2.8, delay: 30 },
      { tier: 'omen', count: 3, spacing: 8, delay: 46 }
    ] }
  }

  OP.ROUND_SETS.standard = OP.ROUNDS_STANDARD

  /**
   * RBE of a whole round set.
   * @param {object} [set] defaults to the standard table
   * @returns {{total:number, byRound:object}} byRound is keyed by round number
   */
  OP.roundSetRBE = function (set) {
    set = set || OP.ROUNDS_STANDARD
    const byRound = {}
    let total = 0
    const keys = Object.keys(set)
    for (let i = 0; i < keys.length; i++) {
      const rbe = OP.Rounds.roundRBE(set[keys[i]])
      byRound[Number(keys[i])] = rbe
      total += rbe
    }
    return { total: total, byRound: byRound }
  }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
