;(function (OP) {
  'use strict'

  /* ALTERNATE WAVES - the second authored round set, retuned against the
     balloon-table mirror that now drives the standard set.

     Same hundred rounds, same overall pressure as a standard game, and a
     completely different shape. The curve is authored against the running
     envelope of the standard table (this set never dips where its counterpart
     dips), so per-round the two sets sit within a bounded ratio of one another
     while staying strictly rising on their own:

       - blimps arrive early and in groups: the first GOLIATH is round 30, the
         first WRAITH round 35, the first LEVIATHAN round 48, the first
         COLOSSUS round 66, the first OMEN round 82 - and every round from 30
         on carries at least one blimp.
       - VEILED shows up in round 8 and never really leaves, including on
         blimp packs (rounds 43 and 54).
       - clumps are tighter: whole groups land on one tick.
       - rounds 17, 18, 25, 27 and 29 are deliberately awkward for a defence
         built from one tower type: a purple wall, a veiled lead, an immunity
         soup, groups pinned to two different paths, and a plated lead.

     RBE is computed from the balloon tree by OP.Rounds.roundRBE(); the
     per-round comments quote the derived figure as a reading aid. The curve
     and the cross-set envelope are asserted by
     tools/suites/roundset-alternate.mjs, which is the thing that must stay
     true.

     Group shape is the one in js/core/rounds.js; hpScale and speedScale stay
     absent so authored rounds inherit scaling from sim.rules. */

  const P = OP.PROP
  const ROUNDS = {}

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

  // 1 - (20 RBE)
  round(1, [
    g('red', 8, 0, 0, 0, -1),
    g('red', 12, 0.45, 1.5, 0, -1)
  ])

  // 2 - (23 RBE)
  round(2, [
    g('green', 7, 0.25, 1, P.VEILED, -1),
    g('red', 2, 0.3, 2, 0, -1)
  ])

  // 3 - (24 RBE)
  round(3, [
    g('green', 8, 0, 1, 0, -1)
  ])

  // 4 - (44 RBE)
  round(4, [
    g('green', 14, 0.12, 1, 0, -1),
    g('red', 2, 0.3, 2, 0, -1)
  ])

  // 5 - (48 RBE)
  round(5, [
    g('green', 16, 0.25, 1, P.VEILED, -1)
  ])

  // 6 - (49 RBE)
  round(6, [
    g('green', 16, 0, 1, 0, -1),
    g('red', 1, 0, 1, 0, -1)
  ])

  // 7 - (51 RBE)
  round(7, [
    g('green', 17, 0.12, 1, P.REGEN, -1)
  ])

  // 8 - (72 RBE)
  round(8, [
    g('blue', 12, 0, 0, P.VEILED, -1),
    g('red', 24, 0.3, 1, 0, -1),
    g('blue', 12, 0.3, 3, 0, -1)
  ])

  // 9 - (73 RBE)
  round(9, [
    g('green', 24, 0, 1, 0, -1),
    g('red', 1, 0, 1, 0, -1)
  ])

  // 10 - (135 RBE)
  round(10, [
    g('white', 12, 0.12, 1, 0, -1),
    g('red', 3, 0.3, 2, 0, -1)
  ])

  // 11 - (138 RBE)
  round(11, [
    g('white', 12, 0.25, 1, P.VEILED, -1),
    g('red', 6, 0.3, 2, 0, -1)
  ])

  // 12 - (139 RBE)
  round(12, [
    g('white', 12, 0, 1, 0, -1),
    g('red', 7, 0.3, 2, 0, -1)
  ])

  // 13 - (140 RBE)
  round(13, [
    g('white', 12, 0.12, 1, 0, -1),
    g('red', 8, 0.3, 2, 0, -1)
  ])

  // 14 - (141 RBE)
  round(14, [
    g('yellow', 20, 0, 0, P.REGEN, -1),
    g('green', 20, 0.3, 1, 0, -1),
    g('red', 1, 0.25, 1, P.VEILED, -1)
  ])

  // 15 - (142 RBE)
  round(15, [
    g('white', 12, 0, 1, 0, -1),
    g('red', 10, 0.3, 2, 0, -1)
  ])

  // 16 - (143 RBE)
  round(16, [
    g('white', 13, 0.12, 1, 0, -1)
  ])

  // 17 - (230 RBE)
  round(17, [
    g('purple', 20, 0, 0, 0, -1),
    g('blue', 5, 0.4, 3, 0, -1)
  ])

  // 18 - (245 RBE)
  round(18, [
    g('lead', 10, 0.3, 0, P.VEILED, -1),
    g('red', 15, 0.3, 2, 0, -1)
  ])

  // 19 - (246 RBE)
  round(19, [
    g('white', 22, 0.12, 1, 0, -1),
    g('red', 4, 0.3, 2, 0, -1)
  ])

  // 20 - (247 RBE)
  round(20, [
    g('lead', 10, 0.25, 1, P.VEILED, -1),
    g('red', 17, 0.3, 2, 0, -1)
  ])

  // 21 - (248 RBE)
  round(21, [
    g('lead', 10, 0, 1, P.REGEN, -1),
    g('red', 18, 0.3, 2, 0, -1)
  ])

  // 22 - (249 RBE)
  round(22, [
    g('lead', 10, 0.12, 1, 0, -1),
    g('red', 19, 0.3, 2, 0, -1)
  ])

  // 23 - (250 RBE)
  round(23, [
    g('ceramic', 1, 0.4, 0, 0, -1),
    g('yellow', 36, 0.25, 1, 0, -1),
    g('red', 2, 0.25, 1, P.VEILED, -1)
  ])

  // 24 - (251 RBE)
  round(24, [
    g('lead', 10, 0, 1, 0, -1),
    g('red', 21, 0.3, 2, 0, -1)
  ])

  // 25 - (311 RBE)
  round(25, [
    g('purple', 6, 0.25, 0, 0, -1),
    g('lead', 3, 0.4, 2, 0, -1),
    g('black', 8, 0, 4, 0, -1),
    g('white', 8, 0.35, 5, 0, -1)
  ])

  // 26 - (312 RBE)
  round(26, [
    g('lead', 13, 0.25, 1, P.VEILED, -1),
    g('red', 13, 0.3, 2, 0, -1)
  ])

  // 27 - (414 RBE)
  round(27, [
    g('black', 12, 0.3, 0, 0, 0),
    g('white', 12, 0.3, 2, 0, 1),
    g('pink', 30, 0.25, 4, 0, -1)
  ])

  // 28 - (415 RBE)
  round(28, [
    g('lead', 18, 0.12, 1, P.REGEN, -1),
    g('red', 1, 0.12, 1, P.REGEN, -1)
  ])

  // 29 - (416 RBE)
  round(29, [
    g('lead', 12, 0.2, 0, P.PLATED, -1),
    g('black', 10, 0.3, 2, 0, -1),
    g('zebra', 1, 0.5, 4, 0, -1),
    g('pink', 1, 0.25, 1, P.VEILED, -1),
    g('red', 2, 0.25, 1, P.VEILED, -1)
  ])

  // 30 - (616 RBE)
  round(30, [
    g('goliath', 1, 1.4, 3, 0, -1)
  ])

  // 31 - (620 RBE)
  round(31, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('yellow', 1, 0.12, 6, 0, -1)
  ])

  // 32 - (621 RBE)
  round(32, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('pink', 1, 0.25, 6, P.VEILED, -1)
  ])

  // 33 - (622 RBE)
  round(33, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('pink', 1, 0, 6, 0, -1),
    g('red', 1, 0, 6, 0, -1)
  ])

  // 34 - (623 RBE)
  round(34, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('pink', 1, 0.12, 6, 0, -1),
    g('red', 2, 0.3, 2, 0, -1)
  ])

  // 35 - (816 RBE)
  round(35, [
    g('wraith', 1, 1.4, 3, 0, -1)
  ])

  // 36 - (817 RBE)
  round(36, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('lead', 8, 0, 6, 0, -1),
    g('red', 17, 0.3, 2, 0, -1)
  ])

  // 37 - (818 RBE)
  round(37, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('lead', 8, 0.12, 6, 0, -1),
    g('red', 18, 0.3, 2, 0, -1)
  ])

  // 38 - (819 RBE)
  round(38, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('lead', 8, 0.25, 6, P.VEILED, -1),
    g('red', 19, 0.3, 2, 0, -1)
  ])

  // 39 - (1101 RBE)
  round(39, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('lead', 21, 0, 6, 0, -1),
    g('red', 2, 0.3, 2, 0, -1)
  ])

  // 40 - (1102 RBE)
  round(40, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('lead', 21, 0.12, 6, 0, -1),
    g('red', 3, 0.3, 2, 0, -1)
  ])

  // 41 - (1387 RBE)
  round(41, [
    g('goliath', 2, 0, 3, 0, -1),
    g('lead', 6, 0.25, 6, P.VEILED, -1),
    g('purple', 1, 0.25, 6, P.VEILED, -1),
    g('pink', 1, 0.25, 6, P.VEILED, -1),
    g('red', 1, 0.25, 6, P.VEILED, -1)
  ])

  // 42 - (1388 RBE)
  round(42, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('lead', 33, 0, 6, P.REGEN, -1),
    g('red', 13, 0.3, 2, 0, -1)
  ])

  // 43 - (1389 RBE)
  round(43, [
    g('goliath', 2, 0.8, 3, P.VEILED, -1),
    g('lead', 6, 0.12, 6, 0, -1),
    g('purple', 1, 0.12, 6, 0, -1),
    g('pink', 1, 0.12, 6, 0, -1),
    g('red', 3, 0.12, 6, 0, -1)
  ])

  // 44 - (1390 RBE)
  round(44, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('lead', 33, 0.25, 6, P.VEILED, -1),
    g('red', 15, 0.3, 2, 0, -1)
  ])

  // 45 - (1548 RBE)
  round(45, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('lead', 40, 0, 6, 0, -1),
    g('red', 12, 0.3, 2, 0, -1)
  ])

  // 46 - (1549 RBE)
  round(46, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('ceramic', 8, 0.12, 6, 0, -1),
    g('red', 101, 0.3, 2, 0, -1)
  ])

  // 47 - (1710 RBE)
  round(47, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('ceramic', 10, 0.25, 6, P.VEILED, -1),
    g('red', 54, 0.3, 2, 0, -1)
  ])

  // 48 - (3164 RBE)
  round(48, [
    g('leviathan', 1, 1.4, 3, 0, -1)
  ])

  // 49 - (3244 RBE)
  round(49, [
    g('goliath', 2, 1.4, 3, 0, -1),
    g('ceramic', 19, 0.12, 6, P.REGEN, -1),
    g('red', 36, 0.3, 2, 0, -1)
  ])

  // 50 - (3245 RBE)
  round(50, [
    g('wraith', 2, 0, 3, 0, -1),
    g('ceramic', 15, 0.25, 6, P.VEILED, -1),
    g('rainbow', 1, 0.25, 6, P.VEILED, -1),
    g('red', 6, 0.25, 6, P.VEILED, -1)
  ])

  // 51 - (3246 RBE)
  round(51, [
    g('goliath', 2, 1.4, 3, 0, -1),
    g('ceramic', 19, 0, 6, 0, -1),
    g('red', 38, 0.3, 2, 0, -1)
  ])

  // 52 - (3247 RBE)
  round(52, [
    g('goliath', 2, 1.4, 3, 0, -1),
    g('ceramic', 19, 0.12, 6, 0, -1),
    g('red', 39, 0.3, 2, 0, -1)
  ])

  // 53 - (3248 RBE)
  round(53, [
    g('goliath', 2, 1.4, 3, 0, -1),
    g('ceramic', 19, 0.25, 6, P.VEILED, -1),
    g('red', 40, 0.3, 2, 0, -1)
  ])

  // 54 - (3312 RBE)
  round(54, [
    g('goliath', 3, 1.4, 3, P.VEILED, -1),
    g('ceramic', 14, 0, 6, 0, -1),
    g('red', 8, 0.3, 2, 0, -1)
  ])

  // 55 - (3601 RBE)
  round(55, [
    g('goliath', 2, 1.4, 3, 0, -1),
    g('ceramic', 22, 0.12, 6, 0, -1),
    g('red', 81, 0.3, 2, 0, -1)
  ])

  // 56 - (3602 RBE)
  round(56, [
    g('goliath', 1, 1.4, 3, 0, -1),
    g('ceramic', 28, 0.25, 6, P.VEILED, -1),
    g('red', 74, 0.3, 2, 0, -1)
  ])

  // 57 - (3603 RBE)
  round(57, [
    g('goliath', 2, 1.4, 3, 0, -1),
    g('ceramic', 22, 0, 6, 0, -1),
    g('red', 83, 0.3, 2, 0, -1)
  ])

  // 58 - (6328 RBE)
  round(58, [
    g('leviathan', 2, 0, 3, 0, -1)
  ])

  // 59 - (6329 RBE)
  round(59, [
    g('goliath', 3, 1.4, 3, 0, -1),
    g('ceramic', 43, 0.25, 6, P.VEILED, -1),
    g('red', 9, 0.3, 2, 0, -1)
  ])

  // 60 - (6330 RBE)
  round(60, [
    g('goliath', 5, 0.7, 3, P.PLATED, -1),
    g('ceramic', 31, 0, 6, 0, -1),
    g('red', 26, 0.3, 2, 0, -1)
  ])

  // 61 - (6331 RBE)
  round(61, [
    g('goliath', 3, 1.4, 3, 0, -1),
    g('ceramic', 43, 0.12, 6, 0, -1),
    g('red', 11, 0.3, 2, 0, -1)
  ])

  // 62 - (6332 RBE)
  round(62, [
    g('goliath', 5, 0.7, 3, 0, -1),
    g('ceramic', 31, 0.25, 6, P.VEILED, -1),
    g('red', 28, 0.3, 2, 0, -1)
  ])

  // 63 - (9800 RBE)
  round(63, [
    g('leviathan', 2, 0.8, 3, P.VEILED, -1),
    g('ceramic', 33, 0, 6, P.REGEN, -1),
    g('zebra', 1, 0, 6, P.REGEN, -1),
    g('red', 17, 0, 6, P.REGEN, -1)
  ])

  // 64 - (9801 RBE)
  round(64, [
    g('goliath', 8, 0.7, 3, 0, -1),
    g('ceramic', 46, 0.12, 6, 0, -1),
    g('red', 89, 0.3, 2, 0, -1)
  ])

  // 65 - (12896 RBE)
  round(65, [
    g('goliath', 7, 0.7, 3, P.PLATED, -1),
    g('ceramic', 82, 0.25, 6, P.VEILED, -1),
    g('red', 56, 0.3, 2, 0, -1)
  ])

  // 66 - (16656 RBE)
  round(66, [
    g('colossus', 1, 1.4, 3, 0, -1)
  ])

  // 67 - (16657 RBE)
  round(67, [
    g('wraith', 7, 0.7, 3, 0, -1),
    g('ceramic', 105, 0.08, 6, 0, -1),
    g('red', 25, 0.3, 2, 0, -1)
  ])

  // 68 - (16658 RBE)
  round(68, [
    g('wraith', 9, 0.7, 3, 0, -1),
    g('ceramic', 89, 0.25, 6, P.VEILED, -1),
    g('red', 58, 0.3, 2, 0, -1)
  ])

  // 69 - (16659 RBE)
  round(69, [
    g('wraith', 9, 0.7, 3, 0, -1),
    g('ceramic', 89, 0, 6, 0, -1),
    g('red', 59, 0.3, 2, 0, -1)
  ])

  // 70 - (16660 RBE)
  round(70, [
    g('wraith', 11, 0.7, 3, P.PLATED, -1),
    g('ceramic', 73, 0.12, 6, P.REGEN, -1),
    g('red', 92, 0.3, 2, 0, -1)
  ])

  // 71 - (16661 RBE)
  round(71, [
    g('wraith', 5, 0.7, 3, 0, -1),
    g('ceramic', 120, 0.08, 6, P.VEILED, -1),
    g('red', 101, 0.3, 2, 0, -1)
  ])

  // 72 - (16662 RBE)
  round(72, [
    g('wraith', 11, 0.7, 3, 0, -1),
    g('ceramic', 73, 0, 6, 0, -1),
    g('red', 94, 0.3, 2, 0, -1)
  ])

  // 73 - (16663 RBE)
  round(73, [
    g('wraith', 8, 0.7, 3, 0, -1),
    g('ceramic', 97, 0.12, 6, 0, -1),
    g('red', 47, 0.3, 2, 0, -1)
  ])

  // 74 - (16664 RBE)
  round(74, [
    g('wraith', 7, 0.7, 3, 0, -1),
    g('ceramic', 105, 0.08, 6, P.VEILED, -1),
    g('red', 32, 0.3, 2, 0, -1)
  ])

  // 75 - (16755 RBE)
  round(75, [
    g('wraith', 10, 0.7, 3, P.PLATED, -1),
    g('ceramic', 82, 0, 6, 0, -1),
    g('red', 67, 0.3, 2, 0, -1)
  ])

  // 76 - (16756 RBE)
  round(76, [
    g('wraith', 9, 0.7, 3, 0, -1),
    g('ceramic', 90, 0.12, 6, 0, -1),
    g('red', 52, 0.3, 2, 0, -1)
  ])

  // 77 - (16757 RBE)
  round(77, [
    g('wraith', 7, 0.7, 3, 0, -1),
    g('ceramic', 106, 0.08, 6, P.VEILED, -1),
    g('red', 21, 0.3, 2, 0, -1)
  ])

  // 78 - (17939 RBE)
  round(78, [
    g('wraith', 9, 0.7, 3, 0, -1),
    g('ceramic', 101, 0, 6, 0, -1),
    g('red', 91, 0.3, 2, 0, -1)
  ])

  // 79 - (28889 RBE)
  round(79, [
    g('wraith', 20, 0.7, 3, 0, -1),
    g('ceramic', 120, 0.08, 6, 0, -1),
    g('red', 89, 0.3, 2, 0, -1)
  ])

  // 80 - (28890 RBE)
  round(80, [
    g('wraith', 10, 0.7, 3, P.PLATED, -1),
    g('ceramic', 199, 0.08, 6, P.VEILED, -1),
    g('red', 34, 0.3, 2, 0, -1)
  ])

  // 81 - (36575 RBE)
  round(81, [
    g('wraith', 14, 0.7, 3, 0, -1),
    g('ceramic', 241, 0, 6, 0, -1),
    g('red', 87, 0.3, 2, 0, -1)
  ])

  // 82 - (55760 RBE)
  round(82, [
    g('omen', 1, 1.4, 3, 0, -1)
  ])

  // 83 - (55761 RBE)
  round(83, [
    g('leviathan', 7, 0.7, 3, 0, -1),
    g('ceramic', 323, 0.05, 6, P.VEILED, -1),
    g('red', 21, 0.3, 2, 0, -1)
  ])

  // 84 - (55762 RBE)
  round(84, [
    g('colossus', 2, 0, 3, 0, -1),
    g('ceramic', 215, 0, 6, P.REGEN, -1),
    g('rainbow', 1, 0, 6, P.REGEN, -1),
    g('zebra', 1, 0, 6, P.REGEN, -1),
    g('red', 20, 0, 6, P.REGEN, -1)
  ])

  // 85 - (55763 RBE)
  round(85, [
    g('leviathan', 9, 0.7, 3, P.PLATED, -1),
    g('ceramic', 262, 0.08, 6, 0, -1),
    g('red', 39, 0.3, 2, 0, -1)
  ])

  // 86 - (55764 RBE)
  round(86, [
    g('leviathan', 4, 0.9, 0, P.PLATED, -1),
    g('ceramic', 414, 0.05, 6, P.VEILED, -1),
    g('rainbow', 1, 0.25, 6, P.VEILED, -1),
    g('red', 5, 0.25, 6, P.VEILED, -1)
  ])

  // 87 - (55765 RBE)
  round(87, [
    g('leviathan', 5, 0.7, 3, 0, -1),
    g('ceramic', 384, 0, 6, 0, -1),
    g('red', 9, 0.3, 2, 0, -1)
  ])

  // 88 - (55766 RBE)
  round(88, [
    g('leviathan', 4, 0.7, 3, 0, -1),
    g('ceramic', 414, 0.05, 6, 0, -1),
    g('red', 54, 0.3, 2, 0, -1)
  ])

  // 89 - (55767 RBE)
  round(89, [
    g('leviathan', 6, 0.7, 3, 0, -1),
    g('ceramic', 353, 0.05, 6, P.VEILED, -1),
    g('red', 71, 0.3, 2, 0, -1)
  ])

  // 90 - (55768 RBE)
  round(90, [
    g('leviathan', 8, 0.7, 3, P.PLATED, -1),
    g('ceramic', 292, 0, 6, 0, -1),
    g('red', 88, 0.3, 2, 0, -1)
  ])

  // 91 - (55769 RBE)
  round(91, [
    g('leviathan', 9, 0.7, 3, 0, -1),
    g('ceramic', 262, 0.08, 6, P.REGEN, -1),
    g('red', 45, 0.3, 2, 0, -1)
  ])

  // 92 - (66248 RBE)
  round(92, [
    g('leviathan', 6, 0.7, 3, 0, -1),
    g('ceramic', 454, 0.05, 6, P.VEILED, -1),
    g('red', 48, 0.3, 2, 0, -1)
  ])

  // 93 - (66249 RBE)
  round(93, [
    g('leviathan', 6, 0.7, 3, 0, -1),
    g('ceramic', 454, 0, 6, 0, -1),
    g('red', 49, 0.3, 2, 0, -1)
  ])

  // 94 - (121744 RBE)
  round(94, [
    g('leviathan', 17, 0.7, 3, 0, -1),
    g('ceramic', 653, 0.05, 6, 0, -1),
    g('red', 44, 0.3, 2, 0, -1)
  ])

  // 95 - (121745 RBE)
  round(95, [
    g('leviathan', 15, 0.7, 3, P.PLATED, -1),
    g('ceramic', 714, 0.05, 6, P.VEILED, -1),
    g('red', 29, 0.3, 2, 0, -1)
  ])

  // 96 - (149257 RBE)
  round(96, [
    g('omen', 2, 0, 3, 0, -1),
    g('colossus', 1, 1.2, 6, 0, -1),
    g('ceramic', 202, 0, 6, 0, -1),
    g('rainbow', 1, 0, 6, 0, -1),
    g('zebra', 1, 0, 6, 0, -1),
    g('red', 3, 0, 6, 0, -1)
  ])

  // 97 - (149258 RBE)
  round(97, [
    g('leviathan', 20, 0.7, 3, 0, -1),
    g('ceramic', 826, 0.05, 6, 0, -1),
    g('red', 74, 0.3, 2, 0, -1)
  ])

  // 98 - (155154 RBE)
  round(98, [
    g('leviathan', 18, 0.7, 3, 0, -1),
    g('ceramic', 944, 0.05, 6, P.VEILED, -1),
    g('red', 26, 0.3, 2, 0, -1)
  ])

  // 99 - (155155 RBE)
  round(99, [
    g('leviathan', 16, 0.7, 3, 0, -1),
    g('ceramic', 1005, 0, 6, 0, -1),
    g('red', 11, 0.3, 2, 0, -1)
  ])

  // 100 - (155156 RBE)
  round(100, [
    g('leviathan', 16, 0.7, 3, P.PLATED, -1),
    g('ceramic', 1005, 0.05, 6, 0, -1),
    g('red', 12, 0.3, 2, 0, -1)
  ])


  OP.ROUNDS_ALTERNATE = ROUNDS

  /* Registered by KEY, because that is what a save records (js/core/sim.js).
     Embedding the table in the save would freeze an in-progress Alternate Waves
     game on whatever tuning shipped the day it started. */
  OP.ROUND_SETS.alternate = ROUNDS
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
