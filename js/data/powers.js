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
    },
    'gold-geyser': {
      key: 'gold-geyser',
      name: 'Gold Geyser',
      short: 'GEYSER',
      blurb: 'A vein of paydirt bursts open for 1,200 cash.',
      effect: 'cash',
      amount: 1200
    },
    'amber-sap': {
      key: 'amber-sap',
      name: 'Amber Sap',
      short: 'AMBER',
      blurb: 'Seal the wounds — restore 80 lives when the current rules allow recovery.',
      effect: 'lives',
      amount: 80
    },
    'frost-veil': {
      key: 'frost-veil',
      name: 'Frost Veil',
      short: 'VEIL',
      blurb: 'A killing frost — every balloon slows by 60 percent for twelve seconds.',
      effect: 'slow',
      duration: 12,
      magnitude: 0.6
    },
    'ember-cloud': {
      key: 'ember-cloud',
      name: 'Ember Cloud',
      short: 'EMBER',
      blurb: 'A drifting haze of embers — every balloon slows by 30 percent for five seconds.',
      effect: 'slow',
      duration: 5,
      magnitude: 0.3
    },
    'meteor-shard': {
      key: 'meteor-shard',
      name: 'Meteor Shard',
      short: 'METEOR',
      blurb: 'Call down a shard that hits every balloon and the active boss for 150 energy damage.',
      effect: 'damage',
      damage: 150,
      dmgType: OP.DMG.ENERGY
    },
    'thorn-burst': {
      key: 'thorn-burst',
      name: 'Thorn Burst',
      short: 'THORN',
      blurb: 'The undergrowth lashes out — every balloon takes 40 sharp damage.',
      effect: 'damage',
      damage: 40,
      dmgType: OP.DMG.SHARP
    }
  }

  OP.POWERS = POWERS
  OP.POWER_ORDER = ['wild-cache', 'hearthfruit', 'briar-snare', 'thunder-stone', 'gold-geyser', 'amber-sap', 'frost-veil', 'ember-cloud', 'meteor-shard', 'thorn-burst']
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
