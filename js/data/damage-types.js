;(function (OP) {
  'use strict'

  /* Damage types.
     The immunity relation lives on the balloon tiers (js/data/balloons.js) as a
     prebuilt `immuneSet`, so resolving "can this hurt that" is one property read.
     This file holds the type vocabulary plus the two universal overrides.
     See ARCHITECTURE.md §3. */

  OP.DMG = {
    NORMAL: 'normal',
    SHARP: 'sharp',
    EXPLOSIVE: 'explosive',
    FIRE: 'fire',
    COLD: 'cold',
    PLASMA: 'plasma',
    ENERGY: 'energy',
    SHATTER: 'shatter',
    ACID: 'acid',
    VOID: 'void'
  }

  OP.DMG_ORDER = [
    'normal', 'sharp', 'explosive', 'fire', 'cold',
    'plasma', 'energy', 'shatter', 'acid', 'void'
  ]

  /* Display metadata — used by the bestiary and the tower panel so a player can
     see *why* a tower is doing nothing to a lead balloon. */
  OP.DMG_META = {
    normal: { label: 'Impact', tint: '#cfd6cc', note: 'No immunities apply.' },
    sharp: { label: 'Sharp', tint: '#d9dee6', note: 'Lead shrugs it off.' },
    explosive: { label: 'Explosive', tint: '#e08a3c', note: 'Black and Zebra ignore it.' },
    fire: { label: 'Fire', tint: '#e2632c', note: 'Purple is unbothered.' },
    cold: { label: 'Cold', tint: '#7fc6e8', note: 'White and Zebra ignore it.' },
    plasma: { label: 'Plasma', tint: '#b678e8', note: 'Purple is unbothered.' },
    energy: { label: 'Energy', tint: '#7de8c6', note: 'Purple is unbothered.' },
    shatter: { label: 'Shatter', tint: '#e8d67d', note: 'Cracks lead open.' },
    acid: { label: 'Acid', tint: '#a8e04a', note: 'Eats through anything given time.' },
    void: { label: 'Void', tint: '#f0e9ff', note: 'Ignores every immunity.' }
  }

  /* Universal overrides. There is exactly one.

     VOID is reserved for paragon-tier effects, so a paragon can never feel
     blanked by a type chart.

     SHATTER needs no override: no tier resists it. That IS the mechanic — a
     sharp-damage tower whose upgrade converts its damage to shatter thereby
     gains the answer to Lead, without a special case anywhere in the resolver. */
  OP.DMG_OVERRIDES = {
    void: { ignoresAll: true }
  }

  /** Does `dmgType` bypass an immunity to `immuneTo`? */
  OP.dmgBypasses = function (dmgType, immuneTo) {
    const o = OP.DMG_OVERRIDES[dmgType]
    if (!o) return false
    if (o.ignoresAll) return true
    return !!(o.ignores && o.ignores[immuneTo])
  }
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))
