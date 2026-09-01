;(function (OP) {
  'use strict'

  /* Persistent consumables. Definitions contain only display data and effect
     parameters; js/core/powers.js owns activation and inventory mutation. */
  const POWERS = {
    'wild-cache': {
      key: 'wild-cache',
      name: 'Wild Cache',
      short: 'CACHE',
      blurb: 'Open a hidden woodland cache for 400 cash.',
      effect: 'cash',
      amount: 400
    },
    hearthfruit: {
      key: 'hearthfruit',
      name: 'Hearthfruit',
      short: 'FRUIT',
      blurb: 'Restore 25 lives when the current rules allow recovery.',
      effect: 'lives',
      amount: 25
    },
    'briar-snare': {
      key: 'briar-snare',
      name: 'Briar Snare',
      short: 'SNARE',
      blurb: 'Slow every balloon on the board by 45 percent for eight seconds.',
      effect: 'slow',
      duration: 8,
      magnitude: 0.45
    },
    'thunder-stone': {
      key: 'thunder-stone',
      name: 'Thunder Stone',
      short: 'STORM',
      blurb: 'Strike every balloon and the active boss for 60 energy damage.',
      effect: 'damage',
      damage: 60,
      dmgType: OP.DMG.ENERGY
    }
  }

  OP.POWERS = POWERS
  OP.POWER_ORDER = ['wild-cache', 'hearthfruit', 'briar-snare', 'thunder-stone']
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
