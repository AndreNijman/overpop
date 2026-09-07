export const name = 'logins'
export const needs = ['js/core/logins.js', 'js/save.js', 'js/core/drafts.js']

export function run (t, OP) {
  const L = OP.Logins
  const today = '2026-09-07'

  t.section('the calendar registers itself')
  t.eq(typeof L, 'object', 'OP.Logins exists')
  t.eq(L.CYCLE, 7, 'a seven-day cycle, like a week of showing up')
  t.eq(typeof L.claim, 'function', 'claim exists')
  t.eq(typeof L.status, 'function', 'status exists')
  t.eq(typeof L.dayOf, 'function', 'dayOf exists')
  t.eq(typeof L.yesterdayOf, 'function', 'yesterdayOf exists')

  t.section('date helpers are pure and bounded')
  t.eq(L.yesterdayOf('2026-09-07'), '2026-09-06', 'yesterdayOf steps one day back')
  t.eq(L.yesterdayOf('2026-03-01'), '2026-02-28', 'month boundaries resolve')
  t.eq(L.yesterdayOf('2027-01-01'), '2026-12-31', 'year boundaries resolve')
  t.eq(L.yesterdayOf('garbage'), '', 'a malformed key yields no yesterday')
  t.eq(L.dayOf(1), 1, 'day one of a streak is calendar day one')
  t.eq(L.dayOf(7), 7, 'and day seven is the jackpot')
  t.eq(L.dayOf(8), 1, 'day eight wraps to calendar day one')
  t.eq(L.dayOf(14), 7, 'and the second cycle ends on the jackpot again')
  t.eq(L.dayOf(0), 1, 'a zero streak reads as day one')

  t.section('a first claim starts the streak')
  const p = OP.Save.defaults()
  const kp0 = p.knowledgePoints
  const first = L.claim(p, today)
  t.ok(first && first.claimed === true, 'the first claim pays out')
  t.eq(first.day, 1, 'on calendar day one')
  t.eq(first.streak, 1, 'with a streak of one')
  t.eq(first.first, true, 'and reports itself as the first-ever claim')
  t.eq(p.knowledgePoints, kp0 + 2, 'day one pays 2 KP')
  t.eq(p.lastLoginDay, today, 'and records the date key')

  t.section('claiming twice on one day pays nothing')
  const again = L.claim(p, today)
  t.ok(again && again.claimed === false, 'the second claim is refused')
  t.eq(p.knowledgePoints, kp0 + 2, 'no KP changed hands')
  t.eq(p.loginTotal, 1, 'the lifetime total did not move')

  t.section('the streak continues across consecutive days')
  const d2 = L.claim(p, '2026-09-08')
  t.ok(d2.claimed === true, 'day two pays')
  t.eq(d2.day, 2, 'on calendar day two')
  t.eq(p.loginStreak, 2, 'streak is two')
  t.eq(p.loginTotal, 2, 'lifetime total is two')
  t.eq(p.knowledgePoints, kp0 + 2 + 3, 'day two pays 3 KP')

  t.section('a missed day resets the streak, not the account')
  const fresh = OP.Save.defaults()
  L.claim(fresh, '2026-09-01')
  L.claim(fresh, '2026-09-02')
  L.claim(fresh, '2026-09-03')
  t.eq(fresh.loginStreak, 3, 'three days in a row builds a streak of three')
  const afterGap = L.claim(fresh, '2026-09-09')
  t.ok(afterGap.claimed === true, 'a claim after the gap still pays')
  t.eq(afterGap.streak, 1, 'but the streak restarted at one')
  t.eq(afterGap.day, 1, 'and the calendar went back to day one')

  t.section('the day-seven jackpot grants a draft token')
  const jackpot = OP.Save.defaults()
  for (let i = 0; i < 6; i++) {
    const day = new Date(Date.UTC(2026, 8, 7 + i))
    const key = day.getUTCFullYear() + '-' + String(day.getUTCMonth() + 1).padStart(2, '0') + '-' + String(day.getUTCDate()).padStart(2, '0')
    L.claim(jackpot, key)
  }
  t.eq(jackpot.loginStreak, 6, 'six days claimed')
  const tokensBefore = jackpot.drafts.reduce((s, d) => s + (d.count || 0), 0)
  const d7 = L.claim(jackpot, '2026-09-13')
  t.eq(d7.day, 7, 'the seventh consecutive day is the jackpot day')
  t.eq(jackpot.knowledgePoints, 2 + 3 + 4 + 5 + 6 + 8 + 12, 'the jackpot pays its full KP ladder')
  const tokensAfter = jackpot.drafts.reduce((s, d) => s + (d.count || 0), 0)
  t.eq(tokensAfter, tokensBefore + 1, 'and exactly one draft token came with it')

  t.section('the same date always draws the same token')
  const drawA = OP.Save.defaults()
  const drawB = OP.Save.defaults()
  for (const pr of [drawA, drawB]) {
    for (let i = 0; i < 7; i++) {
      const key = '2026-08-' + String(2 + i).padStart(2, '0')
      L.claim(pr, key)
    }
  }
  const keyA = drawA.drafts.map(d => d.key + ':' + d.level).sort().join('|')
  const keyB = drawB.drafts.map(d => d.key + ':' + d.level).sort().join('|')
  t.eq(keyA, keyB, 'two profiles claiming the same calendar draw identically — no Math.random')

  t.section('clock rollback never double-pays and never resets')
  const roller = OP.Save.defaults()
  L.claim(roller, '2026-09-10')
  const streakBefore = roller.loginStreak
  const back = L.claim(roller, '2026-09-07')
  t.ok(back && back.claimed === false, 'claiming an earlier day after a later one is refused')
  t.eq(roller.loginStreak, streakBefore, 'the streak is untouched')
  t.eq(roller.lastLoginDay, '2026-09-10', 'the record stays on the later day')

  t.section('status reports what the calendar owes')
  const s0 = L.status(OP.Save.defaults(), today)
  t.eq(s0.available, true, 'a fresh profile has a claim available')
  t.eq(s0.day, 1, 'owing calendar day one')
  t.eq(s0.kp, 2, 'which pays 2 KP')
  t.eq(s0.hasToken, false, 'with no token attached')
  const claimed = L.status({ loginStreak: 1, lastLoginDay: today, knowledgePoints: 0 }, today)
  t.eq(claimed.available, false, 'after claiming, nothing is owed today')
  t.eq(claimed.day, 0, 'and no day is highlighted')

  t.section('status predicts the streak continuation across midnight')
  const ongoing = OP.Save.defaults()
  L.claim(ongoing, '2026-09-06')
  const next = L.status(ongoing, '2026-09-07')
  t.eq(next.available, true, 'the next day is owed')
  t.eq(next.streak, 2, 'and claiming it continues the streak to two')
  t.eq(next.day, 2, 'landing on calendar day two')

  t.section('claims survive a save round-trip')
  const roundTrip = OP.Save.defaults()
  L.claim(roundTrip, '2026-09-01')
  L.claim(roundTrip, '2026-09-02')
  const snap = JSON.parse(JSON.stringify(OP.Save.migrate(roundTrip)))
  t.eq(snap.loginStreak, 2, 'streak serialises')
  t.eq(snap.lastLoginDay, '2026-09-02', 'record day serialises')
  const reloaded = OP.Save.migrate(snap)
  const postReload = L.claim(reloaded, '2026-09-03')
  t.ok(postReload.claimed === true, 'the reload still owes day three')
  t.eq(postReload.streak, 3, 'and the streak carried over')

  t.section('malformed input is refused, not exploded')
  t.eq(L.claim(null, today), null, 'no profile, no claim')
  t.eq(L.claim(OP.Save.defaults(), 'not-a-date'), null, 'a bad date key is refused')
  t.eq(L.status(null, today).available, false, 'status without a profile is simply unavailable')

  t.section('the migration path upgrades an old profile')
  const old = OP.Save.migrate({ schemaVersion: 11, stats: {}, completions: {}, dailyStreak: 3 })
  t.eq(old.schemaVersion, OP.Save.SCHEMA_VERSION, 'migrated to the current schema')
  t.eq(old.loginStreak, 0, 'with login fields defaulted')
  t.eq(old.lastLoginDay, '', 'and no recorded claim')
}
