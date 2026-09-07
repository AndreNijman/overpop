;(function (OP) {
  'use strict'

  /* The standard 100-round table, mirrored from Bloons TD 6 (rounds 1-100).
     Compositions follow the BTD6 standard table (Blooncyclopedia)
     "List of rounds in BTD6"). Overpop balloon names substitute:
     MOAB=GOLIATH, BFB=LEVIATHAN, ZOMG=COLOSSUS, DDT=WRAITH, BAD=OMEN, and
     Camo=VEILED, Regrow=REGEN, Fortified=PLATED. The milestone beats are
     therefore identical to the source game: round 24 = first camo, round 28
     = first lead, round 40 = first GOLIATH, round 60 = first LEVIATHAN,
     round 80 = first COLOSSUS, round 90 = first WRAITH, round 100 = first
     OMEN.

     Spacing and delays are Overpop's own pacing. Groups of 20+ stream in
     bursts, blimp packs space by size (1.5s for a solo blimp down to 0.3s
     for a wall of them), and each group enters on a 2s beat after the one
     before. Individual tight floods can reach 20/s; single-blimp rounds
     release in ~3s. No round lasts longer than ~90s.

     RBE is never written down in this file; it is computed from the balloon
     tree by OP.Rounds.roundRBE / OP.roundSetRBE. The BTD6 table does not
     climb strictly (the famous dip right after the round-40 GOLIATH), so the
     suites assert milestone rounds and pacing etiquette, not a monotone
     curve. */

  const P = OP.PROP

  OP.ROUNDS_STANDARD = {
    1: { groups: [
      { tier: 'red', count: 20, spacing: 0.25, delay: 3.00, props: 0 }
    ] },
    2: { groups: [
      { tier: 'red', count: 35, spacing: 0.25, delay: 3.00, props: 0 }
    ] },
    3: { groups: [
      { tier: 'red', count: 10, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'blue', count: 5, spacing: 0.60, delay: 10.40, props: 0 },
      { tier: 'red', count: 15, spacing: 0.60, delay: 14.80, props: 0 }
    ] },
    4: { groups: [
      { tier: 'red', count: 25, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'blue', count: 18, spacing: 0.60, delay: 11.00, props: 0 },
      { tier: 'red', count: 10, spacing: 0.60, delay: 23.20, props: 0 }
    ] },
    5: { groups: [
      { tier: 'blue', count: 12, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'red', count: 5, spacing: 0.60, delay: 11.60, props: 0 },
      { tier: 'blue', count: 15, spacing: 0.60, delay: 16.00, props: 0 }
    ] },
    6: { groups: [
      { tier: 'green', count: 4, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'red', count: 15, spacing: 0.60, delay: 6.80, props: 0 },
      { tier: 'blue', count: 15, spacing: 0.60, delay: 17.20, props: 0 }
    ] },
    7: { groups: [
      { tier: 'blue', count: 10, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'green', count: 5, spacing: 0.60, delay: 10.40, props: 0 },
      { tier: 'red', count: 20, spacing: 0.25, delay: 14.80, props: 0 },
      { tier: 'blue', count: 10, spacing: 0.60, delay: 21.55, props: 0 }
    ] },
    8: { groups: [
      { tier: 'blue', count: 20, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'green', count: 2, spacing: 0.60, delay: 9.75, props: 0 },
      { tier: 'red', count: 10, spacing: 0.60, delay: 12.35, props: 0 },
      { tier: 'green', count: 12, spacing: 0.60, delay: 19.75, props: 0 }
    ] },
    9: { groups: [
      { tier: 'green', count: 30, spacing: 0.25, delay: 3.00, props: 0 }
    ] },
    10: { groups: [
      { tier: 'blue', count: 60, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'blue', count: 20, spacing: 0.25, delay: 12.08, props: 0 },
      { tier: 'blue', count: 22, spacing: 0.25, delay: 18.83, props: 0 }
    ] },
    11: { groups: [
      { tier: 'yellow', count: 3, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'green', count: 12, spacing: 0.60, delay: 6.20, props: 0 },
      { tier: 'blue', count: 10, spacing: 0.60, delay: 14.80, props: 0 },
      { tier: 'red', count: 10, spacing: 0.60, delay: 22.20, props: 0 }
    ] },
    12: { groups: [
      { tier: 'green', count: 10, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'blue', count: 15, spacing: 0.60, delay: 10.40, props: 0 },
      { tier: 'yellow', count: 5, spacing: 0.60, delay: 20.80, props: 0 }
    ] },
    13: { groups: [
      { tier: 'blue', count: 50, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'green', count: 23, spacing: 0.25, delay: 10.88, props: 0 }
    ] },
    14: { groups: [
      { tier: 'red', count: 18, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'blue', count: 5, spacing: 0.60, delay: 15.20, props: 0 },
      { tier: 'green', count: 5, spacing: 0.60, delay: 19.60, props: 0 },
      { tier: 'yellow', count: 4, spacing: 0.60, delay: 24.00, props: 0 },
      { tier: 'red', count: 31, spacing: 0.25, delay: 27.80, props: 0 },
      { tier: 'blue', count: 10, spacing: 0.60, delay: 37.30, props: 0 },
      { tier: 'green', count: 5, spacing: 0.60, delay: 44.70, props: 0 },
      { tier: 'yellow', count: 5, spacing: 0.60, delay: 49.10, props: 0 }
    ] },
    15: { groups: [
      { tier: 'red', count: 20, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'blue', count: 15, spacing: 0.60, delay: 9.75, props: 0 },
      { tier: 'green', count: 12, spacing: 0.60, delay: 20.15, props: 0 },
      { tier: 'yellow', count: 10, spacing: 0.60, delay: 28.75, props: 0 },
      { tier: 'pink', count: 5, spacing: 0.60, delay: 36.15, props: 0 }
    ] },
    16: { groups: [
      { tier: 'green', count: 20, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'green', count: 20, spacing: 0.25, delay: 9.75, props: 0 },
      { tier: 'yellow', count: 8, spacing: 0.60, delay: 16.50, props: 0 }
    ] },
    17: { groups: [
      { tier: 'yellow', count: 12, spacing: 0.60, delay: 3.00, props: P.REGEN }
    ] },
    18: { groups: [
      { tier: 'green', count: 60, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'green', count: 20, spacing: 0.25, delay: 12.08, props: 0 }
    ] },
    19: { groups: [
      { tier: 'green', count: 10, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'yellow', count: 5, spacing: 0.60, delay: 10.40, props: P.REGEN },
      { tier: 'pink', count: 15, spacing: 0.60, delay: 14.80, props: 0 },
      { tier: 'yellow', count: 4, spacing: 0.60, delay: 25.20, props: 0 }
    ] },
    20: { groups: [
      { tier: 'black', count: 6, spacing: 0.60, delay: 3.00, props: 0 }
    ] },
    21: { groups: [
      { tier: 'yellow', count: 40, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'pink', count: 10, spacing: 0.60, delay: 9.68, props: 0 },
      { tier: 'pink', count: 4, spacing: 0.60, delay: 17.08, props: 0 }
    ] },
    22: { groups: [
      { tier: 'white', count: 16, spacing: 0.60, delay: 3.00, props: 0 }
    ] },
    23: { groups: [
      { tier: 'black', count: 7, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'white', count: 7, spacing: 0.60, delay: 8.60, props: 0 }
    ] },
    24: { groups: [
      { tier: 'green', count: 1, spacing: 0.60, delay: 3.00, props: P.VEILED },
      { tier: 'blue', count: 20, spacing: 0.25, delay: 5.00, props: 0 }
    ] },
    25: { groups: [
      { tier: 'yellow', count: 25, spacing: 0.25, delay: 3.00, props: P.REGEN },
      { tier: 'purple', count: 10, spacing: 0.60, delay: 11.00, props: 0 }
    ] },
    26: { groups: [
      { tier: 'pink', count: 23, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'zebra', count: 4, spacing: 0.60, delay: 10.50, props: 0 }
    ] },
    27: { groups: [
      { tier: 'red', count: 100, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'blue', count: 60, spacing: 0.12, delay: 16.88, props: 0 },
      { tier: 'green', count: 45, spacing: 0.12, delay: 25.96, props: 0 },
      { tier: 'yellow', count: 45, spacing: 0.12, delay: 33.24, props: 0 }
    ] },
    28: { groups: [
      { tier: 'lead', count: 6, spacing: 0.60, delay: 3.00, props: 0 }
    ] },
    29: { groups: [
      { tier: 'yellow', count: 50, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'yellow', count: 15, spacing: 0.60, delay: 10.88, props: P.REGEN }
    ] },
    30: { groups: [
      { tier: 'lead', count: 9, spacing: 0.60, delay: 3.00, props: 0 }
    ] },
    31: { groups: [
      { tier: 'black', count: 8, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'white', count: 8, spacing: 0.60, delay: 9.20, props: 0 },
      { tier: 'zebra', count: 8, spacing: 0.60, delay: 15.40, props: 0 },
      { tier: 'zebra', count: 2, spacing: 0.60, delay: 21.60, props: P.REGEN }
    ] },
    32: { groups: [
      { tier: 'black', count: 15, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'white', count: 20, spacing: 0.25, delay: 13.40, props: 0 },
      { tier: 'purple', count: 10, spacing: 0.60, delay: 20.15, props: 0 }
    ] },
    33: { groups: [
      { tier: 'red', count: 20, spacing: 0.25, delay: 3.00, props: P.VEILED },
      { tier: 'yellow', count: 13, spacing: 0.60, delay: 9.75, props: P.VEILED }
    ] },
    34: { groups: [
      { tier: 'yellow', count: 160, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'zebra', count: 6, spacing: 0.60, delay: 24.08, props: 0 }
    ] },
    35: { groups: [
      { tier: 'white', count: 25, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'rainbow', count: 5, spacing: 0.60, delay: 11.00, props: 0 },
      { tier: 'pink', count: 35, spacing: 0.25, delay: 15.40, props: 0 },
      { tier: 'black', count: 30, spacing: 0.25, delay: 25.90, props: 0 }
    ] },
    36: { groups: [
      { tier: 'pink', count: 40, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'green', count: 10, spacing: 0.60, delay: 9.68, props: P.VEILED | P.REGEN },
      { tier: 'pink', count: 40, spacing: 0.12, delay: 17.08, props: 0 },
      { tier: 'green', count: 10, spacing: 0.60, delay: 23.76, props: P.VEILED | P.REGEN },
      { tier: 'pink', count: 60, spacing: 0.12, delay: 31.16, props: 0 }
    ] },
    37: { groups: [
      { tier: 'black', count: 25, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'white', count: 25, spacing: 0.25, delay: 11.00, props: 0 },
      { tier: 'lead', count: 15, spacing: 0.60, delay: 19.00, props: 0 },
      { tier: 'zebra', count: 10, spacing: 0.60, delay: 29.40, props: 0 },
      { tier: 'white', count: 7, spacing: 0.60, delay: 36.80, props: P.VEILED }
    ] },
    38: { groups: [
      { tier: 'white', count: 17, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'pink', count: 42, spacing: 0.12, delay: 14.60, props: 0 },
      { tier: 'lead', count: 14, spacing: 0.60, delay: 21.52, props: 0 },
      { tier: 'zebra', count: 10, spacing: 0.60, delay: 31.32, props: 0 },
      { tier: 'ceramic', count: 2, spacing: 0.60, delay: 38.72, props: 0 }
    ] },
    39: { groups: [
      { tier: 'black', count: 10, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'white', count: 10, spacing: 0.60, delay: 10.40, props: 0 },
      { tier: 'zebra', count: 20, spacing: 0.25, delay: 17.80, props: 0 },
      { tier: 'rainbow', count: 18, spacing: 0.60, delay: 24.55, props: 0 },
      { tier: 'rainbow', count: 2, spacing: 0.60, delay: 36.75, props: P.REGEN }
    ] },
    40: { groups: [
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 3.00, props: 0 }
    ] },
    41: { groups: [
      { tier: 'black', count: 60, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'zebra', count: 60, spacing: 0.12, delay: 12.08, props: 0 }
    ] },
    42: { groups: [
      { tier: 'rainbow', count: 6, spacing: 0.60, delay: 3.00, props: P.REGEN },
      { tier: 'rainbow', count: 5, spacing: 0.60, delay: 8.00, props: P.VEILED }
    ] },
    43: { groups: [
      { tier: 'rainbow', count: 10, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'ceramic', count: 7, spacing: 0.60, delay: 10.40, props: 0 }
    ] },
    44: { groups: [
      { tier: 'zebra', count: 10, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'zebra', count: 10, spacing: 0.60, delay: 10.40, props: 0 },
      { tier: 'zebra', count: 10, spacing: 0.60, delay: 17.80, props: 0 },
      { tier: 'zebra', count: 10, spacing: 0.60, delay: 25.20, props: 0 },
      { tier: 'zebra', count: 10, spacing: 0.60, delay: 32.60, props: 0 }
    ] },
    45: { groups: [
      { tier: 'rainbow', count: 25, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'purple', count: 10, spacing: 0.60, delay: 11.00, props: P.VEILED },
      { tier: 'pink', count: 180, spacing: 0.12, delay: 18.40, props: 0 },
      { tier: 'lead', count: 4, spacing: 0.60, delay: 41.88, props: P.PLATED }
    ] },
    46: { groups: [
      { tier: 'ceramic', count: 6, spacing: 0.60, delay: 3.00, props: P.PLATED }
    ] },
    47: { groups: [
      { tier: 'ceramic', count: 12, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'pink', count: 70, spacing: 0.12, delay: 11.60, props: P.VEILED }
    ] },
    48: { groups: [
      { tier: 'pink', count: 40, spacing: 0.12, delay: 3.00, props: P.REGEN },
      { tier: 'purple', count: 30, spacing: 0.25, delay: 9.68, props: P.VEILED | P.REGEN },
      { tier: 'rainbow', count: 40, spacing: 0.12, delay: 18.93, props: 0 },
      { tier: 'ceramic', count: 3, spacing: 0.60, delay: 25.61, props: P.PLATED }
    ] },
    49: { groups: [
      { tier: 'green', count: 343, spacing: 0.05, delay: 3.00, props: 0 },
      { tier: 'rainbow', count: 10, spacing: 0.60, delay: 22.10, props: 0 },
      { tier: 'ceramic', count: 18, spacing: 0.60, delay: 29.50, props: 0 },
      { tier: 'zebra', count: 20, spacing: 0.25, delay: 41.70, props: 0 },
      { tier: 'rainbow', count: 10, spacing: 0.60, delay: 48.45, props: 0 },
      { tier: 'rainbow', count: 10, spacing: 0.60, delay: 55.85, props: P.REGEN }
    ] },
    50: { groups: [
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 3.00, props: 0 },
      { tier: 'lead', count: 8, spacing: 0.60, delay: 5.00, props: P.PLATED },
      { tier: 'red', count: 20, spacing: 0.25, delay: 11.20, props: 0 },
      { tier: 'ceramic', count: 20, spacing: 0.25, delay: 17.95, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 24.70, props: 0 }
    ] },
    51: { groups: [
      { tier: 'ceramic', count: 15, spacing: 0.60, delay: 3.00, props: P.VEILED },
      { tier: 'rainbow', count: 10, spacing: 0.60, delay: 13.40, props: P.REGEN }
    ] },
    52: { groups: [
      { tier: 'rainbow', count: 25, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 11.00, props: 0 },
      { tier: 'ceramic', count: 5, spacing: 0.60, delay: 13.00, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 17.40, props: 0 },
      { tier: 'ceramic', count: 5, spacing: 0.60, delay: 19.40, props: 0 }
    ] },
    53: { groups: [
      { tier: 'pink', count: 80, spacing: 0.12, delay: 3.00, props: P.VEILED },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 14.48, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 16.48, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 18.48, props: 0 }
    ] },
    54: { groups: [
      { tier: 'ceramic', count: 35, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 13.50, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 15.50, props: 0 }
    ] },
    55: { groups: [
      { tier: 'ceramic', count: 10, spacing: 0.60, delay: 3.00, props: 0 },
      { tier: 'ceramic', count: 10, spacing: 0.60, delay: 10.40, props: 0 },
      { tier: 'ceramic', count: 10, spacing: 0.60, delay: 17.80, props: 0 },
      { tier: 'ceramic', count: 15, spacing: 0.60, delay: 25.20, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 35.60, props: 0 }
    ] },
    56: { groups: [
      { tier: 'rainbow', count: 40, spacing: 0.12, delay: 3.00, props: P.VEILED },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 9.68, props: 0 }
    ] },
    57: { groups: [
      { tier: 'goliath', count: 2, spacing: 1.50, delay: 3.00, props: 0 },
      { tier: 'rainbow', count: 40, spacing: 0.12, delay: 6.50, props: 0 },
      { tier: 'goliath', count: 2, spacing: 1.50, delay: 13.18, props: 0 }
    ] },
    58: { groups: [
      { tier: 'goliath', count: 5, spacing: 1.50, delay: 3.00, props: 0 },
      { tier: 'ceramic', count: 15, spacing: 0.60, delay: 11.00, props: 0 },
      { tier: 'ceramic', count: 10, spacing: 0.60, delay: 21.40, props: P.PLATED }
    ] },
    59: { groups: [
      { tier: 'ceramic', count: 20, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'lead', count: 50, spacing: 0.12, delay: 9.75, props: P.VEILED },
      { tier: 'ceramic', count: 10, spacing: 0.60, delay: 17.63, props: P.REGEN }
    ] },
    60: { groups: [
      { tier: 'leviathan', count: 1, spacing: 1.50, delay: 3.00, props: 0 }
    ] },
    61: { groups: [
      { tier: 'zebra', count: 150, spacing: 0.12, delay: 3.00, props: P.REGEN },
      { tier: 'goliath', count: 5, spacing: 1.50, delay: 22.88, props: 0 }
    ] },
    62: { groups: [
      { tier: 'purple', count: 250, spacing: 0.08, delay: 3.00, props: 0 },
      { tier: 'goliath', count: 5, spacing: 1.50, delay: 24.92, props: 0 },
      { tier: 'goliath', count: 2, spacing: 1.50, delay: 32.92, props: P.PLATED },
      { tier: 'rainbow', count: 15, spacing: 0.60, delay: 36.42, props: P.VEILED | P.REGEN }
    ] },
    63: { groups: [
      { tier: 'lead', count: 75, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'ceramic', count: 40, spacing: 0.12, delay: 13.88, props: 0 },
      { tier: 'ceramic', count: 40, spacing: 0.12, delay: 20.56, props: 0 },
      { tier: 'ceramic', count: 42, spacing: 0.12, delay: 27.24, props: 0 }
    ] },
    64: { groups: [
      { tier: 'goliath', count: 6, spacing: 0.90, delay: 3.00, props: 0 },
      { tier: 'goliath', count: 3, spacing: 1.50, delay: 9.50, props: P.PLATED }
    ] },
    65: { groups: [
      { tier: 'zebra', count: 100, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'rainbow', count: 70, spacing: 0.12, delay: 16.88, props: 0 },
      { tier: 'ceramic', count: 50, spacing: 0.12, delay: 27.16, props: 0 },
      { tier: 'goliath', count: 3, spacing: 1.50, delay: 35.04, props: 0 },
      { tier: 'leviathan', count: 2, spacing: 1.50, delay: 40.04, props: 0 }
    ] },
    66: { groups: [
      { tier: 'goliath', count: 2, spacing: 1.50, delay: 3.00, props: 0 },
      { tier: 'goliath', count: 2, spacing: 1.50, delay: 6.50, props: 0 },
      { tier: 'goliath', count: 4, spacing: 1.50, delay: 10.00, props: 0 },
      { tier: 'goliath', count: 3, spacing: 1.50, delay: 16.50, props: P.PLATED }
    ] },
    67: { groups: [
      { tier: 'goliath', count: 4, spacing: 1.50, delay: 3.00, props: 0 },
      { tier: 'ceramic', count: 13, spacing: 0.60, delay: 9.50, props: P.VEILED | P.REGEN | P.PLATED },
      { tier: 'goliath', count: 4, spacing: 1.50, delay: 18.70, props: 0 }
    ] },
    68: { groups: [
      { tier: 'goliath', count: 4, spacing: 1.50, delay: 3.00, props: 0 },
      { tier: 'leviathan', count: 1, spacing: 1.50, delay: 9.50, props: 0 }
    ] },
    69: { groups: [
      { tier: 'lead', count: 40, spacing: 0.12, delay: 3.00, props: P.PLATED },
      { tier: 'black', count: 40, spacing: 0.12, delay: 9.68, props: P.REGEN },
      { tier: 'ceramic', count: 50, spacing: 0.12, delay: 16.36, props: 0 }
    ] },
    70: { groups: [
      { tier: 'rainbow', count: 200, spacing: 0.08, delay: 3.00, props: 0 },
      { tier: 'white', count: 120, spacing: 0.12, delay: 20.92, props: P.VEILED | P.REGEN },
      { tier: 'goliath', count: 4, spacing: 1.50, delay: 37.20, props: 0 }
    ] },
    71: { groups: [
      { tier: 'ceramic', count: 30, spacing: 0.25, delay: 3.00, props: 0 },
      { tier: 'goliath', count: 10, spacing: 0.90, delay: 12.25, props: 0 }
    ] },
    72: { groups: [
      { tier: 'ceramic', count: 38, spacing: 0.25, delay: 3.00, props: P.REGEN },
      { tier: 'leviathan', count: 1, spacing: 1.50, delay: 14.25, props: 0 },
      { tier: 'leviathan', count: 1, spacing: 1.50, delay: 16.25, props: 0 }
    ] },
    73: { groups: [
      { tier: 'goliath', count: 7, spacing: 0.90, delay: 3.00, props: 0 },
      { tier: 'leviathan', count: 2, spacing: 1.50, delay: 10.40, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 13.90, props: 0 }
    ] },
    74: { groups: [
      { tier: 'ceramic', count: 50, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'ceramic', count: 25, spacing: 0.25, delay: 10.88, props: P.VEILED | P.REGEN | P.PLATED },
      { tier: 'leviathan', count: 1, spacing: 1.50, delay: 18.88, props: 0 },
      { tier: 'ceramic', count: 60, spacing: 0.12, delay: 20.88, props: P.PLATED }
    ] },
    75: { groups: [
      { tier: 'leviathan', count: 1, spacing: 1.50, delay: 3.00, props: 0 },
      { tier: 'lead', count: 14, spacing: 0.60, delay: 5.00, props: 0 },
      { tier: 'goliath', count: 1, spacing: 1.50, delay: 14.80, props: P.PLATED },
      { tier: 'leviathan', count: 3, spacing: 1.50, delay: 16.80, props: 0 },
      { tier: 'lead', count: 14, spacing: 0.60, delay: 21.80, props: P.PLATED },
      { tier: 'goliath', count: 2, spacing: 1.50, delay: 31.60, props: P.PLATED },
      { tier: 'leviathan', count: 3, spacing: 1.50, delay: 35.10, props: 0 }
    ] },
    76: { groups: [
      { tier: 'ceramic', count: 60, spacing: 0.12, delay: 3.00, props: P.REGEN }
    ] },
    77: { groups: [
      { tier: 'goliath', count: 11, spacing: 0.90, delay: 3.00, props: 0 },
      { tier: 'leviathan', count: 5, spacing: 1.50, delay: 14.00, props: 0 }
    ] },
    78: { groups: [
      { tier: 'rainbow', count: 150, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'ceramic', count: 75, spacing: 0.12, delay: 22.88, props: 0 },
      { tier: 'leviathan', count: 1, spacing: 1.50, delay: 33.76, props: 0 },
      { tier: 'purple', count: 80, spacing: 0.12, delay: 35.76, props: 0 },
      { tier: 'ceramic', count: 72, spacing: 0.12, delay: 47.24, props: P.VEILED }
    ] },
    79: { groups: [
      { tier: 'rainbow', count: 500, spacing: 0.05, delay: 3.00, props: P.REGEN },
      { tier: 'leviathan', count: 4, spacing: 1.50, delay: 29.95, props: 0 },
      { tier: 'leviathan', count: 2, spacing: 1.50, delay: 36.45, props: P.PLATED }
    ] },
    80: { groups: [
      { tier: 'colossus', count: 1, spacing: 1.50, delay: 3.00, props: 0 }
    ] },
    81: { groups: [
      { tier: 'leviathan', count: 9, spacing: 0.90, delay: 3.00, props: 0 },
      { tier: 'leviathan', count: 8, spacing: 0.90, delay: 12.20, props: 0 }
    ] },
    82: { groups: [
      { tier: 'leviathan', count: 10, spacing: 0.90, delay: 3.00, props: 0 },
      { tier: 'leviathan', count: 5, spacing: 1.50, delay: 13.10, props: P.PLATED }
    ] },
    83: { groups: [
      { tier: 'ceramic', count: 40, spacing: 0.12, delay: 3.00, props: 0 },
      { tier: 'ceramic', count: 40, spacing: 0.12, delay: 9.68, props: P.REGEN },
      { tier: 'ceramic', count: 40, spacing: 0.12, delay: 16.36, props: P.PLATED },
      { tier: 'goliath', count: 30, spacing: 0.50, delay: 23.04, props: 0 }
    ] },
    84: { groups: [
      { tier: 'goliath', count: 50, spacing: 0.30, delay: 3.00, props: 0 },
      { tier: 'leviathan', count: 10, spacing: 0.90, delay: 19.70, props: 0 }
    ] },
    85: { groups: [
      { tier: 'colossus', count: 2, spacing: 1.50, delay: 3.00, props: 0 }
    ] },
    86: { groups: [
      { tier: 'leviathan', count: 5, spacing: 1.50, delay: 3.00, props: P.PLATED }
    ] },
    87: { groups: [
      { tier: 'colossus', count: 4, spacing: 1.50, delay: 3.00, props: 0 }
    ] },
    88: { groups: [
      { tier: 'leviathan', count: 8, spacing: 0.90, delay: 3.00, props: 0 },
      { tier: 'goliath', count: 18, spacing: 0.50, delay: 11.30, props: 0 },
      { tier: 'colossus', count: 2, spacing: 1.50, delay: 21.80, props: 0 }
    ] },
    89: { groups: [
      { tier: 'goliath', count: 20, spacing: 0.50, delay: 3.00, props: P.PLATED },
      { tier: 'leviathan', count: 8, spacing: 0.90, delay: 14.50, props: P.PLATED }
    ] },
    90: { groups: [
      { tier: 'lead', count: 50, spacing: 0.12, delay: 3.00, props: P.VEILED | P.REGEN | P.PLATED },
      { tier: 'wraith', count: 3, spacing: 1.50, delay: 10.88, props: 0 }
    ] },
    91: { groups: [
      { tier: 'ceramic', count: 100, spacing: 0.12, delay: 3.00, props: P.PLATED },
      { tier: 'leviathan', count: 20, spacing: 0.50, delay: 16.88, props: 0 }
    ] },
    92: { groups: [
      { tier: 'goliath', count: 50, spacing: 0.30, delay: 3.00, props: P.PLATED },
      { tier: 'colossus', count: 4, spacing: 1.50, delay: 19.70, props: 0 }
    ] },
    93: { groups: [
      { tier: 'leviathan', count: 10, spacing: 0.90, delay: 3.00, props: P.PLATED },
      { tier: 'wraith', count: 6, spacing: 0.90, delay: 13.10, props: 0 }
    ] },
    94: { groups: [
      { tier: 'leviathan', count: 25, spacing: 0.50, delay: 3.00, props: 0 },
      { tier: 'colossus', count: 6, spacing: 0.90, delay: 17.00, props: 0 }
    ] },
    95: { groups: [
      { tier: 'purple', count: 500, spacing: 0.05, delay: 3.00, props: P.VEILED | P.REGEN },
      { tier: 'lead', count: 250, spacing: 0.08, delay: 29.95, props: P.VEILED | P.REGEN | P.PLATED },
      { tier: 'goliath', count: 50, spacing: 0.30, delay: 51.87, props: P.PLATED },
      { tier: 'wraith', count: 30, spacing: 0.50, delay: 68.57, props: 0 }
    ] },
    96: { groups: [
      { tier: 'leviathan', count: 10, spacing: 0.90, delay: 3.00, props: 0 },
      { tier: 'goliath', count: 20, spacing: 0.50, delay: 13.10, props: P.PLATED },
      { tier: 'leviathan', count: 10, spacing: 0.90, delay: 24.60, props: 0 },
      { tier: 'goliath', count: 20, spacing: 0.50, delay: 34.70, props: P.PLATED },
      { tier: 'leviathan', count: 10, spacing: 0.90, delay: 46.20, props: 0 },
      { tier: 'colossus', count: 6, spacing: 0.90, delay: 56.30, props: 0 }
    ] },
    97: { groups: [
      { tier: 'colossus', count: 2, spacing: 1.50, delay: 3.00, props: P.PLATED }
    ] },
    98: { groups: [
      { tier: 'leviathan', count: 30, spacing: 0.50, delay: 3.00, props: P.PLATED },
      { tier: 'colossus', count: 8, spacing: 0.90, delay: 19.50, props: 0 }
    ] },
    99: { groups: [
      { tier: 'goliath', count: 60, spacing: 0.30, delay: 3.00, props: 0 },
      { tier: 'wraith', count: 9, spacing: 0.90, delay: 22.70, props: P.PLATED }
    ] },
    100: { groups: [
      { tier: 'omen', count: 1, spacing: 1.50, delay: 3.00, props: 0 }
    ] },
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
