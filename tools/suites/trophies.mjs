export const name = 'trophies'
export const needs = ['js/data/trophies.js', 'js/core/trophies.js', 'js/save.js', 'js/core/drafts.js']

export function run (t, OP) {
  const T = OP.Trophies

  t.section('the store catalogue is complete and inert')
  t.eq(typeof T, 'object', 'OP.Trophies exists')
  t.ok(OP.TROPHY_ORDER.length >= 45, `${OP.TROPHY_ORDER.length} store items ship`)
  t.eq(new Set(OP.TROPHY_ORDER).size, OP.TROPHY_ORDER.length, 'item keys are unique')
  for (const key of OP.TROPHY_ORDER) {
    const def = OP.TROPHY_ITEMS[key]
    t.ok(OP.TrophyKinds.indexOf(def.kind) >= 0, `${key}: a known kind`)
    t.ok(def.cost >= 1 && def.cost <= 20, `${key}: a sane trophy cost`)
    t.ok(def.name && def.name.length > 3, `${key}: a display name`)
    t.ok(def.blurb && def.blurb.length > 10, `${key}: real flavour text`)
    // Cosmetics only — no catalogue entry may carry a rule or stat payload.
    const payloadKeys = Object.keys(def).filter(k => ['key', 'kind', 'name', 'blurb', 'cost'].indexOf(k) < 0)
    for (const k of payloadKeys) {
      t.ok(['colour', 'glyph', 'label', 'crate'].indexOf(k) >= 0 && typeof def[k] !== 'number',
        `${key}: payload ${k} is cosmetic-only`)
    }
  }
  const kinds = ['trail', 'flag', 'badge', 'title', 'insta']
  for (const kind of kinds) {
    t.gte(OP.trophyItemsOfKind(kind).length, kind === 'insta' ? 5 : 8, `${kind} has a stocked shelf`)
  }

  t.section('the bank never goes negative and never awards for losses')
  const p = OP.Save.defaults()
  t.eq(T.bank(p), 0, 'a fresh profile banks zero')
  t.eq(T.earnForResult({ won: false, difficulty: 'hard' }), 0, 'a loss pays nothing')
  t.eq(T.earnForResult({ won: true, difficulty: 'medium' }), 2, 'a medium win pays 2')
  t.eq(T.earnForResult({ won: true, difficulty: 'relentless', mode: 'purist' }), 6, 'a relentless purist win pays 6')
  t.eq(T.earn(p, 3), 3, 'earning deposits')
  t.eq(T.earn(p, -5), 3, 'a non-positive deposit is ignored')
  t.eq(p.trophyBank, 3, 'the bank was not touched')

  t.section('purchase deducts once and refuses what is unaffordable')
  const item = OP.trophyItemsOfKind('trail')[0]
  t.notOk(T.purchase(p, 'no-such-key').ok, 'an unknown key is refused')
  const poor = OP.Save.defaults()
  const refuse = T.purchase(poor, item.key)
  t.notOk(refuse.ok, 'a broke profile cannot buy')
  t.ok(refuse.reason.indexOf('trophies') >= 0, 'and the refusal names the currency')
  t.eq(poor.trophyBank, 0, 'and nothing was deducted')
  T.earn(p, 10)
  const buy = T.purchase(p, item.key)
  t.ok(buy.ok, 'the purchase succeeds')
  t.eq(p.trophyBank, 13 - item.cost, 'the cost came off the bank')
  t.ok(T.owns(p, item.key), 'and the item is owned')
  const again = T.purchase(p, item.key)
  t.notOk(again.ok, 'a double-tap is refused')
  t.eq(p.trophyBank, 13 - item.cost, 'and charges nothing twice')

  t.section('equipment is one item per slot, and only for owned items')
  t.eq(T.equipped(p, 'trail'), '', 'a purchase does not auto-equip')
  t.ok(T.equip(p, 'trail', item.key).ok, 'equipping an owned item succeeds')
  t.eq(T.equipped(p, 'trail'), item.key, 'the slot reports the item')
  t.notOk(T.equip(p, 'trail', 'no-such-key').ok, 'an unknown key cannot equip')
  t.ok(T.equip(p, 'trail', '').ok, 'a falsy key unequips')
  t.eq(T.equipped(p, 'trail'), '', 'and the slot empties')
  t.ok(T.equip(p, 'trail', item.key).ok, 're-equipping works')
  const other = OP.trophyItemsOfKind('flag')[0]
  T.earn(p, other.cost)
  t.ok(T.purchase(p, other.key).ok, 'the flag is bought')
  t.notOk(T.equip(p, 'trail', other.key).ok, 'a flag cannot go in the trail slot')
  t.eq(T.equipped(p, 'trail'), item.key, 'and the trail slot is untouched')
  t.ok(T.equip(p, 'flag', other.key).ok, 'the flag fits its own slot')

  t.section('an equipped item you no longer own reads as unequipped')
  p.trophyOwned = p.trophyOwned.filter(k => k !== item.key)
  t.eq(T.equipped(p, 'trail'), '', 'the orphaned equip disappears without crashing')

  t.section('crates grant into the Draft inventory and consume themselves')
  const crate = OP.trophyByKey('crate-basic')
  T.earn(p, 5)
  t.ok(T.purchase(p, 'crate-basic').ok, 'the crate is purchasable')
  const before = OP.Drafts.count(p)
  const opened = T.openCrate(p, 'crate-basic')
  t.ok(opened.ok, 'the crate opens')
  t.eq(opened.granted.length, 3, 'it grants three critters')
  t.eq(OP.Drafts.count(p), before + 3, 'the Draft inventory grew by three')
  t.notOk(T.owns(p, 'crate-basic'), 'the crate consumed itself')
  const empty = T.openCrate(p, 'crate-basic')
  t.notOk(empty.ok, 'opening an unowned crate is refused')

  t.section('a win pays into the bank through Save.recordResult')
  const fresh = OP.Save.defaults()
  OP.Save.recordResult(fresh, { won: true, difficulty: 'hard', mode: 'standard', roundsCleared: 40, pops: 10, cash: 10 })
  t.eq(T.bank(fresh), 3, 'a hard win banks 3 trophies')
  t.ok(Array.isArray(fresh.trophyOwned) && fresh.trophyOwned.length === 0, 'and the store list starts empty')

  t.section('the schema migrates cleanly')
  const v12 = OP.Save.defaults()
  v12.schemaVersion = 12
  v12.trophyBank = 7
  v12.trophyOwned = ['badge-oak']
  v12.trophyEquipped = { trail: 'trail-gold' }
  const up = OP.Save.migrate(JSON.parse(JSON.stringify(v12)))
  t.eq(up.trophyBank, 7, 'the bank survives the hop')
  t.deep(up.trophyOwned, ['badge-oak'], 'owned keys survive')
  t.deep(up.trophyEquipped, { trail: 'trail-gold' }, 'equipped slots survive')
  t.eq(up.schemaVersion, OP.Save.SCHEMA_VERSION, 'and lands at the current schema')
  const poisoned = OP.Save.migrate({ schemaVersion: 12, trophyEquipped: { trail: { __proto__: {} } } })
  t.deep(poisoned.trophyEquipped, {}, 'a poisoned equip map degrades to empty')
}
