;(function (OP) {
  'use strict'

  /* ============================================================================
     TROPHIES — the bank, the store and the cosmetic equipment rack.

     Trophies are BANKED by play and SPENT in the store. Three invariants shape
     this module:

       1. THE BANK NEVER GOES NEGATIVE. A purchase deducts; a refused purchase
          deducts nothing. Every call site goes through purchase() so the guard
          lives in one place.
       2. COSMETICS ONLY. A store item may carry a colour or a label; nothing in
          the catalogue may change a rule or a tower stat. The suite proves the
          whole catalogue is inert by checking payloads against a whitelist.
       3. EVERYTHING SURVIVES A SAVE. The bank, the owned list and the equipped
          map are plain profile fields (schema v13); the core is pure functions
          over the profile, so persistence is free and testable without a sim.
     ============================================================================ */

  const Trophies = {}

  /** How many trophies a completed run pays. Mirrors knowledgeEarn's shape:
      a base for winning, scaled by difficulty and hard-mode tiers. */
  Trophies.earnForResult = function (result) {
    if (!result || result.won !== true) return 0
    const diffRank = { easy: 1, medium: 2, hard: 3, relentless: 4 }
    let t = diffRank[result.difficulty] || 1
    const modeBonus = {
      'half-cash': 1, 'double-hp-blimps': 1, 'alternate-waves': 1, 'reverse': 1,
      'purist': 2, 'grim': 3, 'rampart': 3, 'no-mercy': 3,
      'boss-event': 2, 'boss-event-elite': 4
    }
    t += modeBonus[result.mode] || 0
    return t
  }

  /** Deposit trophies. Returns the new bank value. */
  Trophies.earn = function (profile, amount) {
    if (!profile) return 0
    const n = Math.floor(Number(amount))
    if (!(n > 0)) return Trophies.bank(profile)
    profile.trophyBank = Math.max(0, (profile.trophyBank || 0) + n)
    return profile.trophyBank
  }

  Trophies.bank = function (profile) {
    return profile && typeof profile.trophyBank === 'number' && profile.trophyBank > 0
      ? Math.floor(profile.trophyBank) : 0
  }

  Trophies.ownedKeys = function (profile) {
    return profile && Array.isArray(profile.trophyOwned) ? profile.trophyOwned.slice() : []
  }

  Trophies.owns = function (profile, key) {
    return profile && Array.isArray(profile.trophyOwned) && profile.trophyOwned.indexOf(key) >= 0
  }

  /** The equipped key for a kind, or ''. An equipped item you no longer own
      (a future respec removed it) reads as unequipped rather than crashing. */
  Trophies.equipped = function (profile, kind) {
    if (!profile || !profile.trophyEquipped) return ''
    const key = profile.trophyEquipped[kind]
    if (typeof key !== 'string' || !key) return ''
    if (OP.trophyByKey && !OP.trophyByKey(key)) return ''
    if (!Trophies.owns(profile, key)) return ''
    return key
  }

  /** The payload of the equipped item of a kind, or a fallback. */
  Trophies.equippedPayload = function (profile, kind, fallback) {
    const key = Trophies.equipped(profile, kind)
    const item = key && OP.trophyByKey ? OP.trophyByKey(key) : null
    return item ? item : (fallback || null)
  }

  /** Buy a store item: deduct the bank, mark owned. Idempotent-safe: a
      double-tap cannot double-charge, it just reports "already owned". */
  Trophies.purchase = function (profile, key) {
    const def = OP.trophyByKey ? OP.trophyByKey(key) : null
    if (!def) return { ok: false, reason: 'No such store item.' }
    if (Trophies.owns(profile, key)) return { ok: false, reason: 'Already owned.' }
    const bank = Trophies.bank(profile)
    if (bank < def.cost) {
      return { ok: false, reason: 'Not enough trophies — need ' + def.cost + ', have ' + bank + '.' }
    }
    profile.trophyBank = bank - def.cost
    profile.trophyOwned.push(key)
    return { ok: true, reason: '', spent: def.cost }
  }

  /** Equip (or unequip with a falsy key) an owned cosmetic. One item per kind. */
  Trophies.equip = function (profile, kind, key) {
    if (OP.TrophyKinds && OP.TrophyKinds.indexOf(kind) < 0) {
      return { ok: false, reason: 'Unknown slot.' }
    }
    if (!key) {
      delete profile.trophyEquipped[kind]
      return { ok: true, reason: '' }
    }
    const def = OP.trophyByKey ? OP.trophyByKey(key) : null
    if (!def || def.kind !== kind) return { ok: false, reason: 'That item does not fit this slot.' }
    if (!Trophies.owns(profile, key)) return { ok: false, reason: 'You do not own that item.' }
    profile.trophyEquipped[kind] = key
    return { ok: true, reason: '' }
  }

  /* ---------- insta crates ---------- */

  /** Grant an owned crate's contents into the Draft inventory. Deterministic
      per (crate, profile, call count) via the profile's own key list, so a
      reopened menu offers the same draw. */
  Trophies.openCrate = function (profile, key) {
    const def = OP.trophyByKey ? OP.trophyByKey(key) : null
    if (!def || def.kind !== 'insta') return { ok: false, reason: 'Not a crate.' }
    if (!Trophies.owns(profile, key)) return { ok: false, reason: 'You do not own that crate.' }
    const roster = ['veteran', 'elite', 'legend', 'basic'].indexOf(def.crate) >= 0
      ? (OP.TOWER_ORDER || [])
      : (OP.TOWER_ORDER || []).filter(function (k) {
        const d = OP.TOWERS ? OP.TOWERS[k] : null
        return d && d.family === def.crate
      })
    if (!roster.length) return { ok: false, reason: 'No towers registered yet.' }
    if (!OP.Drafts || !OP.Drafts.grant) return { ok: false, reason: 'The critter inventory is not ready.' }

    const tiers = { basic: [1, 1, 1], primary: [2, 2], military: [2, 2], magic: [2, 2], support: [2, 2], veteran: [2, 3], elite: [3, 4], legend: [4, 5] }
    const band = tiers[def.crate] || [1, 1]
    const granted = []
    for (let i = 0; i < band.length; i++) {
      const towerKey = roster[(Trophies.bank(profile) + i * 7 + key.length) % roster.length]
      const level = Math.max(0, Math.min(band[i], 5))
      OP.Drafts.grant(profile, towerKey, level)
      granted.push({ key: towerKey, level: level })
    }
    profile.trophyOwned = profile.trophyOwned.filter(function (k) { return k !== key })
    return { ok: true, reason: '', granted: granted }
  }

  OP.Trophies = Trophies
})(window.OP)
