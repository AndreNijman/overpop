;(function (OP) {
  'use strict'

  /* ALTERNATE WAVES - the second authored round set.

     Same hundred rounds, same overall RBE trajectory as a standard game, and a
     completely different shape. Every round below is hand-composed to punish a
     board that would coast through the standard set:

       - blimps arrive early and in groups. The first GOLIATH is round 20, the
         first LEVIATHAN round 36, the first COLOSSUS round 56, the first OMEN
         round 78 - and they rarely come alone.
       - VEILED shows up in round 8 and never really leaves. Several rounds put
         it on a blimp pack, where a board with one detection tower covering one
         corner simply loses.
       - clumps are tighter. A group with spacing 0 releases its whole count on
         one tick, and this set uses that constantly.
       - a handful of rounds are deliberately awkward for a defence built from a
         single tower type: 17 (twenty purples at once), 18 (veiled lead), 25
         (purple + lead + white + black together), 29 (plated lead), 43 and 54
         (veiled GOLIATH packs).

     RBE is never written down here - it is computed from the balloon tree by
     OP.Rounds.roundRBE(). The per-round comments quote the derived figure purely
     as a reading aid for whoever tunes this next. The curve is asserted by
     tools/suites/roundset-alternate.mjs, which is the thing that must stay true.

     Group shape is the one in js/core/rounds.js:
       { tier, count, spacing, delay, path, props, hpScale, speedScale }
     Anything omitted takes its default from OP.Rounds.normalizeGroup - which is
     why hpScale and speedScale are absent throughout: an authored round inherits
     HP and speed scaling from sim.rules, and only the freeplay generator sets
     them per group. */

  const P = OP.PROP
  const ROUNDS = {}

  // Positional group builder. Keeps a hundred rounds readable; the objects it
  // returns are plain data, exactly what normalizeGroup expects.
  function g (tier, count, spacing, delay, props, path) {
    return {
      tier: tier,
      count: count,
      spacing: spacing,
      delay: delay || 0,
      props: props || 0,
      path: path === undefined ? -1 : path
    }
  }

  function round (n, groups) { ROUNDS[n] = { groups: groups } }

  // 1 - an opening clump, then a trickle - this set groups from round one (20 RBE)
  round(1, [
    g('red', 8, 0),
    g('red', 12, 0.45, 1.5)
  ])

  // 2 - blue a round early, and it arrives as one pack (22 RBE)
  round(2, [
    g('red', 10, 0.3),
    g('blue', 6, 0, 2)
  ])

  // 3 - a blue clump with reds threaded through it (26 RBE)
  round(3, [
    g('blue', 6, 0, 0.5),
    g('red', 14, 0.35)
  ])

  // 4 - green shows up while the blues are still on the board (28 RBE)
  round(4, [
    g('red', 10, 0.25),
    g('blue', 6, 0, 2.5),
    g('green', 2, 0.5, 4)
  ])

  // 5 - a green vanguard over a steady blue stream (33 RBE)
  round(5, [
    g('green', 5, 0.4),
    g('blue', 9, 0.25, 1)
  ])

  // 6 - eight greens on a single tick (37 RBE)
  round(6, [
    g('green', 8, 0, 1),
    g('red', 13, 0.2)
  ])

  // 7 - yellow, fast enough to outrun one slow tower (42 RBE)
  round(7, [
    g('yellow', 6, 0.3),
    g('green', 6, 0.35, 2)
  ])

  // 8 - VEILED, far earlier than a standard game. A board with no detection leaks the lot (47 RBE)
  round(8, [
    g('red', 20, 0.15, 0, P.VEILED),
    g('green', 9, 0.4, 3)
  ])

  // 9 - pinks in a pack behind a yellow screen (53 RBE)
  round(9, [
    g('yellow', 8, 0.25),
    g('pink', 3, 0, 3),
    g('green', 2, 0.35, 1)
  ])

  // 10 - a pink rush at 0.12s spacing - one gap in coverage costs the round (58 RBE)
  round(10, [
    g('pink', 10, 0.12),
    g('yellow', 2, 0.3, 3)
  ])

  // 11 - black and white on the same round: no single immunity answer (69 RBE)
  round(11, [
    g('black', 3, 0.3),
    g('white', 3, 0.3, 1),
    g('green', 1, 0.3)
  ])

  // 12 - veiled greens under a white clump (74 RBE)
  round(12, [
    g('green', 10, 0.2, 0, P.VEILED),
    g('white', 4, 0, 3)
  ])

  // 13 - both immunity clumps land on two ticks, a second and a half apart (93 RBE)
  round(13, [
    g('black', 4, 0),
    g('white', 4, 0, 1.5),
    g('pink', 1, 0.2, 3)
  ])

  // 14 - purple, twenty rounds early. Fire, plasma and energy do nothing here (96 RBE)
  round(14, [
    g('purple', 8, 0.25),
    g('yellow', 2, 0.15, 2)
  ])

  // 15 - lead in front, veiled pinks behind it (110 RBE)
  round(15, [
    g('lead', 3, 0.5),
    g('pink', 6, 0.2, 2, P.VEILED),
    g('black', 1, 0.3, 4)
  ])

  // 16 - zebra: explosive and cold both blanked, and it splits into both parents (124 RBE)
  round(16, [
    g('zebra', 3, 0.35),
    g('black', 3, 0.2, 2),
    g('white', 2, 0.3, 3)
  ])

  // 17 - ten purples on one tick (138 RBE)
  round(17, [
    g('purple', 10, 0),
    g('yellow', 7, 0.2, 2.5)
  ])

  // 18 - veiled lead. Needs detection AND a damage type lead does not shrug off (161 RBE)
  round(18, [
    g('lead', 5, 0.3, 0, P.VEILED),
    g('zebra', 2, 0.4, 3)
  ])

  // 19 - rainbow early, with a lead escort (175 RBE)
  round(19, [
    g('rainbow', 2, 0.4),
    g('lead', 2, 0.25, 2),
    g('pink', 7, 0.2)
  ])

  // 20 - fourteen purples at once - deliberately awkward for a magic-only board (199 RBE)
  round(20, [
    g('purple', 14, 0),
    g('pink', 9, 0.2, 2)
  ])

  // 21 - rainbows as a stream rather than a trickle (233 RBE)
  round(21, [
    g('rainbow', 3, 0.4),
    g('zebra', 4, 0.3, 2)
  ])

  // 22 - veiled rainbows (257 RBE)
  round(22, [
    g('rainbow', 4, 0.2, 0, P.VEILED),
    g('zebra', 3, 0.3, 1)
  ])

  // 23 - ceramic, nine rounds early (302 RBE)
  round(23, [
    g('ceramic', 2, 0.4),
    g('rainbow', 2, 0.3, 2)
  ])

  // 24 - REGEN ceramics: chip damage loses ground (349 RBE)
  round(24, [
    g('ceramic', 2, 0.3, 0, P.REGEN),
    g('rainbow', 3, 0.35, 3)
  ])

  // 25 - immunity soup: purple, lead, white and black in one round (356 RBE)
  round(25, [
    g('purple', 14, 0.2),
    g('lead', 4, 0.3, 1),
    g('white', 6, 0.25, 2),
    g('black', 4, 0.2, 3)
  ])

  // 26 - three ceramics on one tick (406 RBE)
  round(26, [
    g('ceramic', 3, 0),
    g('rainbow', 2, 0.25, 2)
  ])

  // 27 - veiled ceramics (453 RBE)
  round(27, [
    g('ceramic', 3, 0.3, 0, P.VEILED),
    g('rainbow', 3, 0.3, 3)
  ])

  // 28 - PLATED lead - double hull for no extra RBE. Low-damage spam stalls (531 RBE)
  round(28, [
    g('lead', 12, 0.2, 0, P.PLATED),
    g('ceramic', 2, 0, 3),
    g('rainbow', 1, 0.3, 1)
  ])

  // 29 - four ceramics together (557 RBE)
  round(29, [
    g('ceramic', 4, 0),
    g('rainbow', 3, 0.25, 2)
  ])

  // 30 - the first GOLIATH, ten rounds ahead of a standard game (663 RBE)
  round(30, [
    g('goliath', 1, 0, 2),
    g('rainbow', 1, 0.5, 5)
  ])

  // 31 - a GOLIATH over a veiled rainbow stream (710 RBE)
  round(31, [
    g('goliath', 1, 0, 2),
    g('rainbow', 2, 0.3, 0, P.VEILED)
  ])

  // 32 - a GOLIATH with a zebra screen (755 RBE)
  round(32, [
    g('goliath', 1, 0, 3),
    g('zebra', 4, 0.25),
    g('rainbow', 1, 0.3, 1)
  ])

  // 33 - a GOLIATH behind veiled rainbows (827 RBE)
  round(33, [
    g('goliath', 1, 0, 2),
    g('rainbow', 4, 0.2, 0, P.VEILED),
    g('zebra', 1, 0.3, 4)
  ])

  // 34 - WRAITH, eighteen rounds early. Veiled, fast, and sharp and explosive both blanked (863 RBE)
  round(34, [
    g('wraith', 1, 0, 3),
    g('rainbow', 1, 0.3)
  ])

  // 35 - a GOLIATH and a ceramic pair (918 RBE)
  round(35, [
    g('goliath', 1, 0, 2),
    g('ceramic', 2, 0.3),
    g('rainbow', 2, 0.3, 4)
  ])

  // 36 - two ceramics on one tick, a GOLIATH behind them (1012 RBE)
  round(36, [
    g('goliath', 1, 0, 4),
    g('ceramic', 2, 0),
    g('rainbow', 4, 0.25)
  ])

  // 37 - a WRAITH with ceramic support (1118 RBE)
  round(37, [
    g('wraith', 1, 0, 3),
    g('ceramic', 2, 0.3),
    g('rainbow', 2, 0.3)
  ])

  // 38 - two GOLIATHs on the same tick - grouped blimps are what this set does (1279 RBE)
  round(38, [
    g('goliath', 2, 0, 2),
    g('rainbow', 1, 0.3, 5)
  ])

  // 39 - a GOLIATH and a WRAITH, one after the other (1536 RBE)
  round(39, [
    g('goliath', 1, 0, 2),
    g('wraith', 1, 0, 6),
    g('ceramic', 1, 0.3)
  ])

  // 40 - two GOLIATHs and a ceramic clump (1591 RBE)
  round(40, [
    g('goliath', 2, 1.5, 2),
    g('ceramic', 3, 0, 6),
    g('rainbow', 1, 0.3)
  ])

  // 41 - two WRAITHs (1736 RBE)
  round(41, [
    g('wraith', 2, 2, 2),
    g('ceramic', 1, 0.3)
  ])

  // 42 - two GOLIATHs and a WRAITH (2095 RBE)
  round(42, [
    g('goliath', 2, 1.2, 2),
    g('wraith', 1, 0, 6),
    g('rainbow', 1, 0.3)
  ])

  // 43 - three GOLIATHs over a ceramic clump (2103 RBE)
  round(43, [
    g('goliath', 3, 1, 1.5),
    g('ceramic', 2, 0, 6),
    g('rainbow', 1, 0.3)
  ])

  // 44 - two GOLIATHs, a WRAITH and a ceramic pair (2303 RBE)
  round(44, [
    g('goliath', 2, 1, 2),
    g('wraith', 1, 0, 6),
    g('ceramic', 2, 0.3),
    g('rainbow', 1, 0.3, 10)
  ])

  // 45 - three VEILED GOLIATHs. A blimp pack no undetecting board can touch (2368 RBE)
  round(45, [
    g('goliath', 3, 0.8, 1, P.VEILED),
    g('ceramic', 5, 0.3, 6)
  ])

  // 46 - three WRAITHs over a ceramic clump (2703 RBE)
  round(46, [
    g('wraith', 3, 1.5, 2),
    g('ceramic', 2, 0),
    g('rainbow', 1, 0.25, 6)
  ])

  // 47 - four GOLIATHs on one tick (2776 RBE)
  round(47, [
    g('goliath', 4, 0, 2),
    g('ceramic', 3, 0.3, 6)
  ])

  // 48 - two GOLIATHs and two WRAITHs (2968 RBE)
  round(48, [
    g('goliath', 2, 1, 2),
    g('wraith', 2, 1.5, 6),
    g('ceramic', 1, 0.3)
  ])

  // 49 - LEVIATHAN, eleven rounds early (3268 RBE)
  round(49, [
    g('leviathan', 1, 0, 3),
    g('ceramic', 1, 0.3)
  ])

  // 50 - five GOLIATHs in a line (3392 RBE)
  round(50, [
    g('goliath', 5, 0.7, 1),
    g('ceramic', 3, 0.3, 6)
  ])

  // 51 - a LEVIATHAN with regen ceramics (3768 RBE)
  round(51, [
    g('leviathan', 1, 0, 2),
    g('ceramic', 4, 0.3, 0, P.REGEN),
    g('rainbow', 4, 0.3, 6)
  ])

  // 52 - four WRAITHs (4096 RBE)
  round(52, [
    g('wraith', 4, 1.2, 1.5),
    g('ceramic', 8, 0.3)
  ])

  // 53 - a LEVIATHAN with a GOLIATH pair as escort (4604 RBE)
  round(53, [
    g('leviathan', 1, 0, 2),
    g('goliath', 2, 1, 6),
    g('ceramic', 2, 0.3)
  ])

  // 54 - seven GOLIATHs (5040 RBE)
  round(54, [
    g('goliath', 7, 0.6, 1),
    g('ceramic', 7, 0.25, 8)
  ])

  // 55 - a LEVIATHAN and a WRAITH pair (5524 RBE)
  round(55, [
    g('leviathan', 1, 0, 2),
    g('wraith', 2, 1.5, 6),
    g('ceramic', 7, 0.3)
  ])

  // 56 - eight veiled GOLIATHs (6072 RBE)
  round(56, [
    g('goliath', 8, 0.5, 1, P.VEILED),
    g('ceramic', 11, 0.25, 8)
  ])

  // 57 - two LEVIATHANs on one tick (6744 RBE)
  round(57, [
    g('leviathan', 2, 0, 3),
    g('ceramic', 4, 0.3)
  ])

  // 58 - a LEVIATHAN behind six GOLIATHs (7380 RBE)
  round(58, [
    g('leviathan', 1, 0, 2),
    g('goliath', 6, 0.6, 8),
    g('ceramic', 5, 0.3)
  ])

  // 59 - six WRAITHs - a veiled blimp pack - and a LEVIATHAN (8164 RBE)
  round(59, [
    g('wraith', 6, 1, 1.5),
    g('leviathan', 1, 0, 10),
    g('ceramic', 1, 0.3)
  ])

  // 60 - two LEVIATHANs and four GOLIATHs (8980 RBE)
  round(60, [
    g('leviathan', 2, 2, 2),
    g('goliath', 4, 0.7, 10),
    g('rainbow', 4, 0.3)
  ])

  // 61 - three LEVIATHANs (9908 RBE)
  round(61, [
    g('leviathan', 3, 1.8, 2),
    g('ceramic', 4, 0.25)
  ])

  // 62 - two LEVIATHANs and four WRAITHs, split across the flanks (10961 RBE)
  round(62, [
    g('leviathan', 2, 2, 2),
    g('wraith', 4, 1, 10, 0, 0),
    g('ceramic', 10, 0.2, 0, 0, 1),
    g('rainbow', 7, 0.3, 14)
  ])

  // 63 - three LEVIATHANs over a twenty-ceramic stream (12089 RBE)
  round(63, [
    g('leviathan', 3, 1.5, 2),
    g('ceramic', 20, 0.15),
    g('rainbow', 11, 0.3)
  ])

  // 64 - four LEVIATHANs (13280 RBE)
  round(64, [
    g('leviathan', 4, 1.5, 2),
    g('ceramic', 6, 0.25, 10)
  ])

  // 65 - three LEVIATHANs and eight veiled GOLIATHs (14702 RBE)
  round(65, [
    g('leviathan', 3, 1.5, 2),
    g('goliath', 8, 0.4, 10, P.VEILED),
    g('rainbow', 6, 0.3)
  ])

  // 66 - five LEVIATHANs (16236 RBE)
  round(66, [
    g('leviathan', 5, 1.2, 2),
    g('ceramic', 4, 0.25, 10)
  ])

  // 67 - COLOSSUS, thirteen rounds early (17864 RBE)
  round(67, [
    g('colossus', 1, 0, 4),
    g('ceramic', 8, 0.2),
    g('rainbow', 8, 0.3)
  ])

  // 68 - six LEVIATHANs and a regen ceramic stream (19712 RBE)
  round(68, [
    g('leviathan', 6, 1, 2),
    g('ceramic', 7, 0.25, 10, P.REGEN)
  ])

  // 69 - a COLOSSUS and a LEVIATHAN (21753 RBE)
  round(69, [
    g('colossus', 1, 0, 3),
    g('leviathan', 1, 0, 10),
    g('ceramic', 10, 0.2),
    g('rainbow', 19, 0.3, 14)
  ])

  // 70 - seven LEVIATHANs and a WRAITH pair (23988 RBE)
  round(70, [
    g('leviathan', 7, 0.9, 2),
    g('wraith', 2, 1.5, 12),
    g('ceramic', 2, 0.25)
  ])

  // 71 - a COLOSSUS, two LEVIATHANs and a twenty-ceramic stream (26380 RBE)
  round(71, [
    g('colossus', 1, 0, 2),
    g('leviathan', 2, 2, 10),
    g('ceramic', 20, 0.15),
    g('rainbow', 28, 0.3)
  ])

  // 72 - eight LEVIATHANs and veiled ceramics (29037 RBE)
  round(72, [
    g('leviathan', 8, 0.8, 2),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('rainbow', 35, 0.3)
  ])

  // 73 - a COLOSSUS and four LEVIATHANs (31909 RBE)
  round(73, [
    g('colossus', 1, 0, 2),
    g('leviathan', 4, 1.2, 10),
    g('ceramic', 20, 0.15),
    g('rainbow', 11, 0.3)
  ])

  // 74 - two COLOSSUS on one tick (35080 RBE)
  round(74, [
    g('colossus', 2, 0, 3),
    g('ceramic', 17, 0.25)
  ])

  // 75 - a COLOSSUS and six LEVIATHANs (38566 RBE)
  round(75, [
    g('colossus', 1, 0, 2),
    g('leviathan', 6, 1, 10),
    g('ceramic', 20, 0.15),
    g('rainbow', 18, 0.3)
  ])

  // 76 - two COLOSSUS and two LEVIATHANs (42425 RBE)
  round(76, [
    g('colossus', 2, 2, 3),
    g('leviathan', 2, 1.5, 12),
    g('ceramic', 20, 0.15),
    g('rainbow', 15, 0.3)
  ])

  // 77 - two COLOSSUS, three LEVIATHANs and four WRAITHs (46588 RBE)
  round(77, [
    g('colossus', 2, 1.8, 2),
    g('leviathan', 3, 1.2, 10),
    g('wraith', 4, 1, 16),
    g('ceramic', 5, 0.25)
  ])

  // 78 - three COLOSSUS (51320 RBE)
  round(78, [
    g('colossus', 3, 1.5, 3),
    g('ceramic', 13, 0.2, 12)
  ])

  // 79 - OMEN, nineteen rounds early. No single ability deletes it (56364 RBE)
  round(79, [
    g('omen', 1, 0, 4),
    g('ceramic', 4, 0.3),
    g('rainbow', 4, 0.3)
  ])

  // 80 - three COLOSSUS and three LEVIATHANs (62010 RBE)
  round(80, [
    g('colossus', 3, 1.5, 2),
    g('leviathan', 3, 1.2, 12),
    g('ceramic', 20, 0.15),
    g('rainbow', 10, 0.3)
  ])

  // 81 - four COLOSSUS (67248 RBE)
  round(81, [
    g('colossus', 4, 1.5, 3),
    g('ceramic', 6, 0.2, 12)
  ])

  // 82 - an OMEN and four LEVIATHANs (72946 RBE)
  round(82, [
    g('omen', 1, 0, 3),
    g('leviathan', 4, 1.2, 10),
    g('ceramic', 30, 0.15),
    g('rainbow', 30, 0.25)
  ])

  // 83 - four COLOSSUS and three LEVIATHANs (79132 RBE)
  round(83, [
    g('colossus', 4, 1.2, 2),
    g('leviathan', 3, 1.2, 12),
    g('ceramic', 29, 0.2)
  ])

  // 84 - an OMEN, a COLOSSUS and three LEVIATHANs, split across the flanks (85868 RBE)
  round(84, [
    g('omen', 1, 0, 3),
    g('colossus', 1, 0, 10, 0, 0),
    g('leviathan', 3, 1.2, 16, 0, 1),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('rainbow', 40, 0.25)
  ])

  // 85 - five COLOSSUS (93160 RBE)
  round(85, [
    g('colossus', 5, 1.2, 3),
    g('ceramic', 95, 0.2, 12)
  ])

  // 86 - an OMEN and two COLOSSUS (101032 RBE)
  round(86, [
    g('omen', 1, 0, 3),
    g('colossus', 2, 2, 10),
    g('ceramic', 115, 0.2)
  ])

  // 87 - six COLOSSUS and a regen ceramic stream (109608 RBE)
  round(87, [
    g('colossus', 6, 1, 3),
    g('ceramic', 93, 0.2, 12, P.REGEN)
  ])

  // 88 - two OMEN on one tick, with veiled ceramics (118904 RBE)
  round(88, [
    g('omen', 2, 0, 4),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('ceramic', 51, 0.2, 2)
  ])

  // 89 - an OMEN and four COLOSSUS (129040 RBE)
  round(89, [
    g('omen', 1, 0, 2),
    g('colossus', 4, 1.5, 8),
    g('ceramic', 64, 0.2)
  ])

  // 90 - two OMEN and a COLOSSUS (140032 RBE)
  round(90, [
    g('omen', 2, 3, 3),
    g('colossus', 1, 0, 12),
    g('ceramic', 114, 0.2)
  ])

  // 91 - two OMEN and two COLOSSUS (152528 RBE)
  round(91, [
    g('omen', 2, 2.5, 3),
    g('colossus', 2, 2, 12),
    g('ceramic', 74, 0.2)
  ])

  // 92 - two OMEN and three COLOSSUS (166168 RBE)
  round(92, [
    g('omen', 2, 2, 3),
    g('colossus', 3, 1.5, 12),
    g('ceramic', 20, 0.15),
    g('ceramic', 25, 0.2, 2)
  ])

  // 93 - three OMEN (181112 RBE)
  round(93, [
    g('omen', 3, 2.5, 3),
    g('ceramic', 20, 0.15),
    g('ceramic', 113, 0.2, 2)
  ])

  // 94 - three OMEN and a COLOSSUS (197248 RBE)
  round(94, [
    g('omen', 3, 2, 3),
    g('colossus', 1, 0, 14),
    g('ceramic', 20, 0.15),
    g('ceramic', 108, 0.2, 2)
  ])

  // 95 - three OMEN, two COLOSSUS and veiled ceramics (214944 RBE)
  round(95, [
    g('omen', 3, 1.8, 3),
    g('colossus', 2, 2, 14),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('ceramic', 118, 0.2, 2)
  ])

  // 96 - four OMEN (234168 RBE)
  round(96, [
    g('omen', 4, 2, 3),
    g('ceramic', 107, 0.2, 12)
  ])

  // 97 - four OMEN and a COLOSSUS (255192 RBE)
  round(97, [
    g('omen', 4, 1.8, 3),
    g('colossus', 1, 0, 14),
    g('ceramic', 20, 0.15),
    g('ceramic', 129, 0.2, 2)
  ])

  // 98 - five OMEN (278904 RBE)
  round(98, [
    g('omen', 5, 1.5, 3),
    g('ceramic', 1, 0.2, 12)
  ])

  // 99 - five OMEN and a COLOSSUS (302840 RBE)
  round(99, [
    g('omen', 5, 1.2, 3),
    g('colossus', 1, 0, 14),
    g('ceramic', 20, 0.15),
    g('ceramic', 51, 0.2, 2)
  ])

  // 100 - five OMEN on one tick, two COLOSSUS, and a WRAITH escort. The wall (329976 RBE)
  round(100, [
    g('omen', 5, 0, 5),
    g('colossus', 2, 1.5, 14),
    g('wraith', 8, 0.6, 30),
    g('ceramic', 109, 0.15, 35)
  ])

  OP.ROUNDS_ALTERNATE = ROUNDS

  /* Registered by KEY, because that is what a save records (js/core/sim.js).
     Embedding the table in the save would freeze an in-progress Alternate Waves
     game on whatever tuning shipped the day it started. */
  OP.ROUND_SETS.alternate = ROUNDS
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
