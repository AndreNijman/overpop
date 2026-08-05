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

  // 2 - blue a round early, and it arrives as one pack (24 RBE)
  round(2, [
    g('red', 10, 0.3),
    g('blue', 7, 0, 2)
  ])

  // 3 - a blue clump with reds threaded through it (30 RBE)
  round(3, [
    g('blue', 6, 0, 0.5),
    g('red', 18, 0.35)
  ])

  // 4 - green shows up while the blues are still on the board (35 RBE)
  round(4, [
    g('red', 10, 0.25),
    g('blue', 8, 0, 2.5),
    g('green', 3, 0.5, 4)
  ])

  // 5 - a green vanguard over a steady blue stream (44 RBE)
  round(5, [
    g('green', 6, 0.4),
    g('blue', 13, 0.25, 1)
  ])

  // 6 - ten greens on a single tick (54 RBE)
  round(6, [
    g('green', 10, 0, 1),
    g('red', 24, 0.2)
  ])

  // 7 - yellow, fast enough to outrun one slow tower (65 RBE)
  round(7, [
    g('yellow', 8, 0.3),
    g('green', 11, 0.35, 2)
  ])

  // 8 - VEILED, far earlier than a standard game. A board with no detection leaks the lot (80 RBE)
  round(8, [
    g('red', 20, 0.15, 0, P.VEILED),
    g('green', 20, 0.4, 3)
  ])

  // 9 - pinks in a pack behind a yellow screen (99 RBE)
  round(9, [
    g('yellow', 10, 0.25),
    g('pink', 4, 0, 3),
    g('green', 13, 0.35, 1)
  ])

  // 10 - a pink rush at 0.12s spacing - one gap in coverage costs the round (120 RBE)
  round(10, [
    g('pink', 12, 0.12),
    g('yellow', 15, 0.3, 3)
  ])

  // 11 - black and white on the same round: no single immunity answer (144 RBE)
  round(11, [
    g('black', 6, 0.3),
    g('white', 6, 0.3, 1),
    g('green', 4, 0.3)
  ])

  // 12 - veiled greens under a white clump (179 RBE)
  round(12, [
    g('green', 12, 0.2, 0, P.VEILED),
    g('white', 13, 0, 3)
  ])

  // 13 - both immunity clumps land on two ticks, a second and a half apart (211 RBE)
  round(13, [
    g('black', 8, 0),
    g('white', 8, 0, 1.5),
    g('pink', 7, 0.2, 3)
  ])

  // 14 - purple, eighteen rounds early. Fire, plasma and energy do nothing here (258 RBE)
  round(14, [
    g('purple', 14, 0.25),
    g('yellow', 26, 0.15, 2)
  ])

  // 15 - lead in front, veiled pinks behind it (311 RBE)
  round(15, [
    g('lead', 8, 0.5),
    g('pink', 10, 0.2, 2, P.VEILED),
    g('black', 7, 0.3, 4)
  ])

  // 16 - zebra: explosive and cold both blanked, and it splits into both parents (371 RBE)
  round(16, [
    g('zebra', 8, 0.35),
    g('black', 8, 0.2, 2),
    g('white', 9, 0.3, 3)
  ])

  // 17 - twenty purples on one tick - deliberately awkward for a magic-only board (452 RBE)
  round(17, [
    g('purple', 20, 0),
    g('yellow', 58, 0.2, 2.5)
  ])

  // 18 - veiled lead. Needs detection AND a damage type lead does not shrug off (552 RBE)
  round(18, [
    g('lead', 12, 0.3, 0, P.VEILED),
    g('zebra', 12, 0.4, 3)
  ])

  // 19 - rainbow early, with a lead escort (664 RBE)
  round(19, [
    g('rainbow', 8, 0.4),
    g('lead', 6, 0.25, 2),
    g('pink', 30, 0.2)
  ])

  // 20 - the first GOLIATH, twenty rounds ahead of a standard game (802 RBE)
  round(20, [
    g('goliath', 1, 0, 2),
    g('zebra', 4, 0.3),
    g('rainbow', 2, 0.5, 5)
  ])

  // 21 - ceramics as a stream rather than a trickle (906 RBE)
  round(21, [
    g('ceramic', 6, 0.4),
    g('rainbow', 6, 0.3, 2)
  ])

  // 22 - a GOLIATH behind three ceramics dropped together (1022 RBE)
  round(22, [
    g('ceramic', 3, 0),
    g('goliath', 1, 0, 3),
    g('rainbow', 2, 0.3, 1)
  ])

  // 23 - REGEN ceramics: chip damage loses ground (1161 RBE)
  round(23, [
    g('ceramic', 8, 0.3, 0, P.REGEN),
    g('rainbow', 7, 0.35, 3)
  ])

  // 24 - two GOLIATHs together - grouped blimps are what this set does (1279 RBE)
  round(24, [
    g('goliath', 2, 1.5, 2),
    g('rainbow', 1, 0.3)
  ])

  // 25 - immunity soup: purple, lead, white and black in one round (1440 RBE)
  round(25, [
    g('purple', 24, 0.2),
    g('lead', 10, 0.3, 1),
    g('white', 12, 0.25, 2),
    g('black', 74, 0.2, 3)
  ])

  // 26 - ten ceramics on one tick with veiled rainbows chasing them (1623 RBE)
  round(26, [
    g('ceramic', 10, 0),
    g('rainbow', 8, 0.2, 3, P.VEILED),
    g('zebra', 9, 0.3, 1)
  ])

  // 27 - two GOLIATHs behind a veiled rainbow screen (1826 RBE)
  round(27, [
    g('goliath', 2, 1.2, 1.5),
    g('rainbow', 6, 0.2, 4, P.VEILED),
    g('ceramic', 3, 0.5, 6)
  ])

  // 28 - WRAITH. Veiled, fast, and sharp and explosive both blanked (2071 RBE)
  round(28, [
    g('wraith', 1, 0, 3),
    g('ceramic', 8, 0.25),
    g('rainbow', 9, 0.3, 1)
  ])

  // 29 - PLATED lead - double hull for no extra RBE. Low-damage spam stalls (2326 RBE)
  round(29, [
    g('lead', 20, 0.2, 0, P.PLATED),
    g('ceramic', 8, 0, 3),
    g('rainbow', 22, 0.3, 1)
  ])

  // 30 - three GOLIATHs with a veiled ceramic clump behind them (2593 RBE)
  round(30, [
    g('goliath', 3, 1, 2),
    g('ceramic', 4, 0, 6, P.VEILED),
    g('rainbow', 7, 0.25)
  ])

  // 31 - a twenty-ceramic stream and one GOLIATH (2837 RBE)
  round(31, [
    g('ceramic', 20, 0.2),
    g('goliath', 1, 0, 4),
    g('rainbow', 3, 0.3, 1)
  ])

  // 32 - two WRAITHs - the detection had better be permanent by now (3068 RBE)
  round(32, [
    g('wraith', 2, 2, 2),
    g('ceramic', 12, 0.25),
    g('rainbow', 4, 0.3, 1)
  ])

  // 33 - four GOLIATHs, eight tenths of a second apart (3296 RBE)
  round(33, [
    g('goliath', 4, 0.8, 1.5),
    g('ceramic', 8, 0.3, 6)
  ])

  // 34 - regen ceramics at 0.15s spacing, one GOLIATH at the back (3629 RBE)
  round(34, [
    g('ceramic', 24, 0.15, 0, P.REGEN),
    g('goliath', 1, 0, 5),
    g('rainbow', 11, 0.3, 1)
  ])

  // 35 - two GOLIATHs on the same tick, a WRAITH behind them (3920 RBE)
  round(35, [
    g('goliath', 2, 0, 2),
    g('wraith', 1, 0, 5),
    g('ceramic', 18, 0.3)
  ])

  // 36 - LEVIATHAN, twenty-four rounds early (4278 RBE)
  round(36, [
    g('leviathan', 1, 0, 3),
    g('ceramic', 8, 0.2),
    g('rainbow', 6, 0.3, 1)
  ])

  // 37 - five GOLIATHs in a line (4640 RBE)
  round(37, [
    g('goliath', 5, 0.7, 1),
    g('ceramic', 15, 0.3, 6)
  ])

  // 38 - three WRAITHs over a ten-ceramic clump (5086 RBE)
  round(38, [
    g('wraith', 3, 1.5, 2),
    g('ceramic', 10, 0),
    g('rainbow', 34, 0.25, 1)
  ])

  // 39 - a LEVIATHAN with a GOLIATH pair as escort (5540 RBE)
  round(39, [
    g('leviathan', 1, 0, 2),
    g('goliath', 2, 1, 6),
    g('ceramic', 11, 0.3)
  ])

  // 40 - six GOLIATHs and a WRAITH (5968 RBE)
  round(40, [
    g('goliath', 6, 0.6, 1),
    g('wraith', 1, 0, 8),
    g('ceramic', 14, 0.25, 10)
  ])

  // 41 - two LEVIATHANs (6432 RBE)
  round(41, [
    g('leviathan', 2, 3, 2),
    g('ceramic', 1, 0.3)
  ])

  // 42 - four WRAITHs, then three GOLIATHs (6880 RBE)
  round(42, [
    g('wraith', 4, 1.2, 1.5),
    g('goliath', 3, 1, 6),
    g('ceramic', 17, 0.3)
  ])

  // 43 - eight VEILED GOLIATHs. A blimp pack no undetecting board can touch (7424 RBE)
  round(43, [
    g('goliath', 8, 0.5, 1, P.VEILED),
    g('ceramic', 24, 0.3, 8)
  ])

  // 44 - a LEVIATHAN, three WRAITHs and a ceramic stream (7894 RBE)
  round(44, [
    g('leviathan', 1, 0, 2),
    g('wraith', 3, 1.5, 6),
    g('ceramic', 12, 0.2),
    g('rainbow', 22, 0.3, 1)
  ])

  // 45 - two LEVIATHANs with a GOLIATH pair (8496 RBE)
  round(45, [
    g('leviathan', 2, 2.5, 2),
    g('goliath', 2, 1, 8),
    g('ceramic', 9, 0.3)
  ])

  // 46 - ten GOLIATHs and two WRAITHs (9144 RBE)
  round(46, [
    g('goliath', 10, 0.4, 1),
    g('wraith', 2, 2, 8),
    g('ceramic', 13, 0.25, 12)
  ])

  // 47 - two LEVIATHANs on one tick, with regen ceramics (9724 RBE)
  round(47, [
    g('leviathan', 2, 0, 3),
    g('ceramic', 20, 0.2, 0, P.REGEN),
    g('rainbow', 28, 0.3, 1)
  ])

  // 48 - six WRAITHs - a veiled blimp pack - and a LEVIATHAN (10452 RBE)
  round(48, [
    g('wraith', 6, 1, 1.5),
    g('leviathan', 1, 0, 8),
    g('ceramic', 23, 0.3)
  ])

  // 49 - three LEVIATHANs and two GOLIATHs on the same tick (11244 RBE)
  round(49, [
    g('leviathan', 3, 2, 2),
    g('goliath', 2, 0, 8),
    g('ceramic', 5, 0.3)
  ])

  // 50 - twelve GOLIATHs, a LEVIATHAN and a WRAITH pair (12235 RBE)
  round(50, [
    g('goliath', 12, 0.35, 1),
    g('leviathan', 1, 0, 8),
    g('wraith', 2, 1.5, 12),
    g('rainbow', 1, 0.3)
  ])

  // 51 - three LEVIATHANs over a twenty-four ceramic stream (12740 RBE)
  round(51, [
    g('leviathan', 3, 1.8, 2),
    g('ceramic', 24, 0.15),
    g('rainbow', 16, 0.3, 1)
  ])

  // 52 - eight WRAITHs and two LEVIATHANs (13584 RBE)
  round(52, [
    g('wraith', 8, 0.8, 1),
    g('leviathan', 2, 2, 8),
    g('ceramic', 7, 0.3)
  ])

  // 53 - four LEVIATHANs (14424 RBE)
  round(53, [
    g('leviathan', 4, 1.5, 2),
    g('ceramic', 17, 0.2, 10)
  ])

  // 54 - sixteen veiled GOLIATHs and a LEVIATHAN (15308 RBE)
  round(54, [
    g('goliath', 16, 0.3, 1, P.VEILED),
    g('leviathan', 1, 0, 10),
    g('ceramic', 22, 0.25)
  ])

  // 55 - four LEVIATHANs on one tick, regen ceramics behind them (16254 RBE)
  round(55, [
    g('leviathan', 4, 0, 3),
    g('ceramic', 12, 0.2, 0, P.REGEN),
    g('rainbow', 50, 0.3, 1)
  ])

  // 56 - COLOSSUS, twenty-four rounds early (17260 RBE)
  round(56, [
    g('colossus', 1, 0, 4),
    g('ceramic', 4, 0.3),
    g('rainbow', 4, 0.3, 1)
  ])

  // 57 - five LEVIATHANs and a WRAITH pair (18388 RBE)
  round(57, [
    g('leviathan', 5, 1.2, 2),
    g('wraith', 2, 1.5, 10),
    g('ceramic', 9, 0.3)
  ])

  // 58 - a COLOSSUS with four GOLIATHs (19536 RBE)
  round(58, [
    g('colossus', 1, 0, 3),
    g('goliath', 4, 0.6, 10),
    g('ceramic', 4, 0.3)
  ])

  // 59 - six LEVIATHANs (20695 RBE)
  round(59, [
    g('leviathan', 6, 1, 2),
    g('ceramic', 16, 0.2),
    g('rainbow', 1, 0.3, 1)
  ])

  // 60 - a COLOSSUS, a LEVIATHAN and four WRAITHs (23131 RBE)
  round(60, [
    g('colossus', 1, 0, 2),
    g('leviathan', 1, 0, 8),
    g('wraith', 4, 1, 14),
    g('rainbow', 1, 0.3)
  ])

  // 61 - seven LEVIATHANs and a veiled ceramic stream (24275 RBE)
  round(61, [
    g('leviathan', 7, 0.9, 2),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('rainbow', 1, 0.3, 1)
  ])

  // 62 - a COLOSSUS and two LEVIATHANs (24544 RBE)
  round(62, [
    g('colossus', 1, 0, 3),
    g('leviathan', 2, 2, 10),
    g('ceramic', 15, 0.25)
  ])

  // 63 - a COLOSSUS behind twelve veiled GOLIATHs (25920 RBE)
  round(63, [
    g('colossus', 1, 0, 2),
    g('goliath', 12, 0.3, 8, P.VEILED),
    g('ceramic', 18, 0.25)
  ])

  // 64 - eight LEVIATHANs and a WRAITH pair (27360 RBE)
  round(64, [
    g('leviathan', 8, 0.8, 2),
    g('wraith', 2, 1.5, 12),
    g('ceramic', 4, 0.3)
  ])

  // 65 - a COLOSSUS and three LEVIATHANs (28956 RBE)
  round(65, [
    g('colossus', 1, 0, 2),
    g('leviathan', 3, 1.5, 10),
    g('ceramic', 27, 0.25)
  ])

  // 66 - a COLOSSUS, four LEVIATHANs and a regen ceramic stream (30560 RBE)
  round(66, [
    g('colossus', 1, 0, 2),
    g('leviathan', 4, 1.2, 8),
    g('ceramic', 12, 0.2, 0, P.REGEN)
  ])

  // 67 - nine LEVIATHANs and four WRAITHs, split across the flanks (32260 RBE)
  round(67, [
    g('leviathan', 9, 0.7, 2),
    g('wraith', 4, 1, 14, 0, 0),
    g('ceramic', 5, 0.3, 0, 0, 1)
  ])

  // 68 - two COLOSSUS (34040 RBE)
  round(68, [
    g('colossus', 2, 2.5, 3),
    g('ceramic', 7, 0.25)
  ])

  // 69 - a COLOSSUS, five LEVIATHANs and a ceramic stream (35966 RBE)
  round(69, [
    g('colossus', 1, 0, 2),
    g('leviathan', 5, 1.2, 10),
    g('ceramic', 20, 0.15),
    g('rainbow', 30, 0.3, 1)
  ])

  // 70 - two COLOSSUS on one tick, four WRAITHs behind them (38032 RBE)
  round(70, [
    g('colossus', 2, 0, 3),
    g('wraith', 4, 1, 10),
    g('ceramic', 14, 0.2)
  ])

  // 71 - two COLOSSUS, a LEVIATHAN and a twenty-four ceramic stream (39912 RBE)
  round(71, [
    g('colossus', 2, 2, 3),
    g('leviathan', 1, 0, 10),
    g('ceramic', 24, 0.15),
    g('rainbow', 20, 0.3, 1)
  ])

  // 72 - twelve LEVIATHANs and four WRAITHs (41960 RBE)
  round(72, [
    g('leviathan', 12, 0.6, 2),
    g('wraith', 4, 1, 14),
    g('ceramic', 7, 0.25)
  ])

  // 73 - two COLOSSUS and three LEVIATHANs (44052 RBE)
  round(73, [
    g('colossus', 2, 1.8, 3),
    g('leviathan', 3, 1.2, 10),
    g('ceramic', 12, 0.25)
  ])

  // 74 - two COLOSSUS, three LEVIATHANs and a WRAITH pair (46204 RBE)
  round(74, [
    g('colossus', 2, 1.5, 2),
    g('leviathan', 3, 1, 8),
    g('wraith', 2, 1.2, 16),
    g('ceramic', 17, 0.25)
  ])

  // 75 - two COLOSSUS together, four LEVIATHANs, and veiled ceramics (48518 RBE)
  round(75, [
    g('colossus', 2, 0, 3),
    g('leviathan', 4, 1, 10),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('rainbow', 10, 0.3, 1)
  ])

  // 76 - three COLOSSUS (51008 RBE)
  round(76, [
    g('colossus', 3, 2, 3),
    g('ceramic', 10, 0.2, 12)
  ])

  // 77 - two COLOSSUS, five LEVIATHANs and four WRAITHs (53540 RBE)
  round(77, [
    g('colossus', 2, 1.5, 2),
    g('leviathan', 5, 1, 10),
    g('wraith', 4, 1, 16),
    g('ceramic', 11, 0.25)
  ])

  // 78 - OMEN, twenty-two rounds early. No single ability deletes it (56223 RBE)
  round(78, [
    g('omen', 1, 0, 4),
    g('ceramic', 4, 0.3),
    g('rainbow', 1, 0.3, 1)
  ])

  // 79 - three COLOSSUS and two LEVIATHANs (59000 RBE)
  round(79, [
    g('colossus', 3, 1.8, 3),
    g('leviathan', 2, 1.5, 12),
    g('ceramic', 26, 0.25)
  ])

  // 80 - an OMEN, a LEVIATHAN and a regen ceramic stream (61991 RBE)
  round(80, [
    g('omen', 1, 0, 3),
    g('leviathan', 1, 0, 12),
    g('ceramic', 20, 0.15, 0, P.REGEN),
    g('rainbow', 21, 0.3, 1)
  ])

  // 81 - three COLOSSUS, four LEVIATHANs and four WRAITHs (65935 RBE)
  round(81, [
    g('colossus', 3, 1.5, 2),
    g('leviathan', 4, 1, 12),
    g('wraith', 4, 0.8, 18),
    g('rainbow', 1, 0.3)
  ])

  // 82 - an OMEN and four LEVIATHANs (70127 RBE)
  round(82, [
    g('omen', 1, 0, 3),
    g('leviathan', 4, 1.2, 10),
    g('ceramic', 16, 0.15),
    g('rainbow', 1, 0.3, 1)
  ])

  // 83 - four COLOSSUS and a LEVIATHAN (73636 RBE)
  round(83, [
    g('colossus', 4, 1.5, 3),
    g('leviathan', 1, 0, 14),
    g('ceramic', 37, 0.2)
  ])

  // 84 - an OMEN, a COLOSSUS and veiled ceramics (77995 RBE)
  round(84, [
    g('omen', 1, 0, 3),
    g('colossus', 1, 0, 12),
    g('ceramic', 8, 0.2, 0, P.VEILED),
    g('rainbow', 101, 0.25, 1)
  ])

  // 85 - four COLOSSUS and four LEVIATHANs (82608 RBE)
  round(85, [
    g('colossus', 4, 1.2, 2),
    g('leviathan', 4, 1, 12),
    g('ceramic', 32, 0.2)
  ])

  // 86 - an OMEN, a COLOSSUS and two LEVIATHANs (87480 RBE)
  round(86, [
    g('omen', 1, 0, 3),
    g('colossus', 1, 0, 10),
    g('leviathan', 2, 1.5, 16),
    g('ceramic', 84, 0.2)
  ])

  // 87 - five COLOSSUS and two LEVIATHANs (92624 RBE)
  round(87, [
    g('colossus', 5, 1.2, 3),
    g('leviathan', 2, 1.5, 14),
    g('ceramic', 29, 0.2)
  ])

  // 88 - an OMEN, two COLOSSUS and a veiled ceramic stream (98061 RBE)
  round(88, [
    g('omen', 1, 0, 3),
    g('colossus', 2, 2, 10),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('rainbow', 147, 0.25, 1)
  ])

  // 89 - an OMEN, two COLOSSUS, four LEVIATHANs and a WRAITH pair, split across the flanks (103880 RBE)
  round(89, [
    g('omen', 1, 0, 2),
    g('colossus', 2, 1.5, 8, 0, 0),
    g('leviathan', 4, 1, 16, 0, 1),
    g('wraith', 2, 1, 20),
    g('ceramic', 5, 0.2)
  ])

  // 90 - an OMEN and three COLOSSUS (109992 RBE)
  round(90, [
    g('omen', 1, 0, 2),
    g('colossus', 3, 1.5, 10),
    g('ceramic', 41, 0.2, 16)
  ])

  // 91 - two OMEN (118810 RBE)
  round(91, [
    g('omen', 2, 4, 3),
    g('ceramic', 24, 0.15),
    g('rainbow', 102, 0.25, 1)
  ])

  // 92 - an OMEN, four COLOSSUS and two LEVIATHANs (128759 RBE)
  round(92, [
    g('omen', 1, 0, 2),
    g('colossus', 4, 1.5, 8),
    g('leviathan', 2, 1.5, 16),
    g('rainbow', 1, 0.25)
  ])

  // 93 - two OMEN, a COLOSSUS and veiled ceramics (138680 RBE)
  round(93, [
    g('omen', 2, 3, 3),
    g('colossus', 1, 0, 12),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('ceramic', 81, 0.2, 2)
  ])

  // 94 - two OMEN and two COLOSSUS (149824 RBE)
  round(94, [
    g('omen', 2, 2.5, 3),
    g('colossus', 2, 2, 12),
    g('ceramic', 48, 0.2)
  ])

  // 95 - two OMEN on one tick, two COLOSSUS and four LEVIATHANs (161752 RBE)
  round(95, [
    g('omen', 2, 0, 4),
    g('colossus', 2, 1.5, 12),
    g('leviathan', 4, 1, 18),
    g('ceramic', 41, 0.2)
  ])

  // 96 - three OMEN with a regen ceramic stream (174768 RBE)
  round(96, [
    g('omen', 3, 3, 3),
    g('ceramic', 24, 0.15, 0, P.REGEN),
    g('ceramic', 48, 0.2, 2)
  ])

  // 97 - three OMEN and a COLOSSUS (188824 RBE)
  round(97, [
    g('omen', 3, 2.5, 3),
    g('colossus', 1, 0, 14),
    g('ceramic', 47, 0.2)
  ])

  // 98 - three OMEN, two COLOSSUS and a LEVIATHAN (203964 RBE)
  round(98, [
    g('omen', 3, 2, 3),
    g('colossus', 2, 2, 12),
    g('leviathan', 1, 0, 18),
    g('ceramic', 2, 0.2)
  ])

  // 99 - three OMEN, three COLOSSUS and veiled ceramics (220315 RBE)
  round(99, [
    g('omen', 3, 1.5, 3),
    g('colossus', 3, 1.5, 14),
    g('ceramic', 20, 0.15, 0, P.VEILED),
    g('rainbow', 21, 0.25, 1)
  ])

  // 100 - three OMEN on one tick, four COLOSSUS, and a WRAITH escort. The wall (240536 RBE)
  round(100, [
    g('omen', 3, 0, 5),
    g('colossus', 4, 1.2, 14),
    g('wraith', 8, 0.6, 30),
    g('ceramic', 1, 0.15, 35)
  ])

  OP.ROUNDS_ALTERNATE = ROUNDS

  /* Registered by KEY, because that is what a save records (js/core/sim.js).
     Embedding the table in the save would freeze an in-progress Alternate Waves
     game on whatever tuning shipped the day it started. */
  OP.ROUND_SETS.alternate = ROUNDS
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
