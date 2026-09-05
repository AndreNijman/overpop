;(function (OP) {
  'use strict'

  /* Draft Tokens: collected free placements.

     A token binds one tower to one starting upgrade level. Placing one is
     free — no cash ever changes hands for a draft tower — and the tower is
     born on the first branch at the token's tier, like a hero starts levelled.
     The token is consumed by the placement.

     Tokens are earned rather than bought: each newly-beaten Boss Event tier,
     each improved Rush Trial best, and any Legends chest that finds the
     artifact pool exhausted pays out one token. The collection screen is
     js/ui/drafts-screen.js. */

  const Drafts = {}
  Drafts.MAX_LEVEL = 3

  function safeKey (k) {
    return typeof k === 'string' && k !== '' && k !== '__proto__'
  }

  function clampLevel (level) {
    if (!(typeof level === 'number') || !isFinite(level) || level <= 0) return 0
    return Math.min(Drafts.MAX_LEVEL, Math.floor(level))
  }

  function towerDef (key) {
    if (!safeKey(key)) return null
    return (OP.TOWERS && OP.TOWERS[key]) || null
  }

  /** Read every distinct token slot as { key, level, count }, sorted by family,
      then tower key, then level — the same grouping the shop uses, so the
      collection screen reads top-down the way the roster does. */
  Drafts.list = function (profile) {
    const raw = profile && Array.isArray(profile.drafts) ? profile.drafts : []
    const famIdx = Array.isArray(OP.FAMILIES) ? OP.FAMILIES : []
    const slots = []
    for (let i = 0; i < raw.length; i++) {
      const e = raw[i]
      if (!e || typeof e !== 'object') continue
      const def = towerDef(e.key)
      if (!def) continue
      const level = clampLevel(e.level)
      const count = Number.isInteger(e.count) && e.count > 0 ? e.count : 1
      slots.push({ key: e.key, level: level, count: count, def: def })
    }
    slots.sort(function (a, b) {
      const fa = famIdx.indexOf(a.def.family)
      const fb = famIdx.indexOf(b.def.family)
      if (fa !== fb) return fa - fb
      if (a.key !== b.key) return a.key < b.key ? -1 : 1
      return a.level - b.level
    })
    const out = []
    for (let i = 0; i < slots.length; i++) {
      out.push({ key: slots[i].key, level: slots[i].level, count: slots[i].count })
    }
    return out
  }

  /** Total tokens owned across all slots. */
  Drafts.count = function (profile) {
    const list = Drafts.list(profile)
    let total = 0
    for (let i = 0; i < list.length; i++) total += list[i].count
    return total
  }

  /** The tower tier array a token's level maps onto: [level, 0, 0]. */
  Drafts.tiers = function (level) {
    return [clampLevel(level), 0, 0]
  }

  /** Add one token to a (key, level) slot, creating the slot if needed.
      Mutates profile in place. Returns the slot object, or null for an
      unknown tower key or a missing profile. */
  Drafts.grant = function (profile, key, level) {
    if (!profile) return null
    if (!Array.isArray(profile.drafts)) profile.drafts = []
    if (!towerDef(key)) return null
    level = clampLevel(level)
    const drafts = profile.drafts
    for (let i = 0; i < drafts.length; i++) {
      const s = drafts[i]
      if (s && s.key === key && clampLevel(s.level) === level) {
        s.count = Number.isInteger(s.count) && s.count > 0 ? s.count + 1 : 2
        return s
      }
    }
    const slot = { key: key, level: level, count: 1 }
    drafts.push(slot)
    return slot
  }

  /** Spend one token from a (key, level) slot. Returns true when a token was
      actually owned and removed. Does not place anything. */
  Drafts.consume = function (profile, key, level) {
    if (!profile || !Array.isArray(profile.drafts)) return false
    level = clampLevel(level)
    const drafts = profile.drafts
    for (let i = 0; i < drafts.length; i++) {
      const s = drafts[i]
      if (!s || s.key !== key || clampLevel(s.level) !== level) continue
      s.count = Number.isInteger(s.count) && s.count > 0 ? s.count - 1 : 0
      if (s.count <= 0) drafts.splice(i, 1)
      return true
    }
    return false
  }

  /* Rarity: a token's level is drawn from a slot distribution — tier-0 tokens
     are the common drop, tier-3 tokens the jackpot. */
  const LEVEL_DRAW = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 1,
    2, 2, 2,
    3]

  function weightedLevel (rng) {
    return LEVEL_DRAW[rng.int(LEVEL_DRAW.length)]
  }

  /**
   * Hand out one token for a random tower. Prefers a tower no token exists for
   * yet — the early returns diversify the collection — then falls back to any
   * tower once every kind is tokenised. `rng` defaults to Math.random; pass a
   * seeded OP.RNG to make a test deterministic.
   */
  Drafts.grantRandom = function (profile, rng) {
    if (!profile || !OP.TOWER_ORDER) return null
    const rand = rng || { int: function (n) { return Math.floor(Math.random() * n) } }
    const owned = Drafts.list(profile)
    const have = {}
    for (let i = 0; i < owned.length; i++) have[owned[i].key] = true
    const fresh = []
    const rest = []
    for (let i = 0; i < OP.TOWER_ORDER.length; i++) {
      const k = OP.TOWER_ORDER[i]
      if (!towerDef(k)) continue
      if (!have[k]) fresh.push(k)
      else rest.push(k)
    }
    const pool = fresh.length ? fresh : rest
    if (!pool.length) return null
    const key = pool[rand.int(pool.length)]
    const level = weightedLevel(rand)
    return Drafts.grant(profile, key, level)
  }

  /**
   * Place a draft tower: geometry-only legality check, free placement, the
   * token's tiers applied and the tower restatted, token consumed.
   *
   * Returns the tower on success. On a geometry refusal returns
   * { ok:false, reason } and spends nothing. On any other failure (locked out,
   * nothing owned) returns null and spends nothing.
   */
  Drafts.place = function (sim, profile, key, level, x, y) {
    if (!sim || !profile) return null
    const def = towerDef(key)
    if (!def) return null
    level = clampLevel(level)

    // A token is free, but a draft still has to fit the board. canPlaceShape is
    // the geometry half — bounds, map mask, overlap — and ignores money, mode
    // and the XP gate, all of which a token bypasses.
    const shape = OP.Towers.canPlaceShape(sim, def, x, y)
    if (!shape.ok) return { ok: false, reason: shape.reason }

    if (!Drafts.consume(profile, key, level)) return null

    const tower = OP.Towers.place(sim, key, x, y, { free: true })
    if (!tower) {
      // Unreachable after canPlaceShape passed, but a refund keeps the promise
      // that a token is only ever spent on a tower that actually lands.
      Drafts.grant(profile, key, level)
      return null
    }

    // The draft is a born-upgraded tower: first branch at the token's tier, and
    // the upgrade cash set in so sells value the whole tower. restat applies
    // every owned tier exactly as a bought upgrade would.
    tower.tiers[0] = level
    tower.tiers[1] = 0
    tower.tiers[2] = 0
    tower.invested = OP.Upgrades.investedBase(tower)
    OP.Towers.restat(sim, tower)
    if (tower.def.buffs) OP.Towers.restatAll(sim)

    return tower
  }

  OP.Drafts = Drafts
})(typeof window !== 'undefined' ? (window.OP = window.OP || {}) : (globalThis.OP = globalThis.OP || {}))