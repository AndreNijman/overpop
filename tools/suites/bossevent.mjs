export const name = 'bossevent'
export const needs = ['js/data/bosses.js', 'js/core/bossevent.js', 'js/core/drafts.js', 'js/save.js',
  'js/data/maps-intermediate.js', 'js/data/maps-advanced.js']

export function run (t, OP) {
  const BE = OP.BossEvent
  t.ok(BE, 'the Boss Event engine ships')

  /* a freeze-dried "finished run" the recorder accepts, so we never need the
     full sim to exercise the ledger */
  function runLike (bossKey, tiers, won, elite) {
    const sim = {
      rules: { bossKey: bossKey },
      stats: { bossTiersKilled: tiers },
      outcome: won ? 'won' : 'leaked'
    }
    if (elite) sim.rules.bossElite = true
    return sim
  }
  function freshProfile () {
    return OP.Save.defaults()
  }

  t.section('the weekly rotation is a stable, repeating calendar')
  const epoch = new Date(2026, 0, 5) // Monday
  const start = BE.weekIndex(epoch)
  t.eq(start, 0, 'the epoch week is week zero')
  t.eq(BE.weekIndex(new Date(2026, 0, 12)), 1, 'seven days later is the next week')
  t.eq(BE.weekIndex(new Date(2026, 0, 11)), 0, 'six days later is still the same week')
  t.ok(BE.weekKey(epoch), 'a week key is produced')
  t.eq(BE.mapKey(epoch), BE.mapKey(epoch), 'the map pick is deterministic for the same date')
  t.eq(BE.seed(epoch, 'storm-drake'), 'boss-week-0-storm-drake', 'the seed is deterministic')
  t.ok(BE.mapKey(epoch) && typeof BE.mapKey(epoch) === 'string', 'a map is chosen for the week')
  if (OP.MAPS && OP.MAPS[BE.mapKey(epoch)]) t.ok(true, 'the chosen map is a real map')

  const f0 = BE.featuredBoss(epoch)
  const f1 = BE.featuredBoss(new Date(2026, 0, 12))
  t.ok(f0 !== null, 'a featured boss is chosen')
  t.neq(f0, f1, 'the featured boss advances each week')
  t.ok(OP.bossRoster().map(b => b.key).includes(f0), 'the featured boss is on the roster')
  t.eq(BE.featuredBoss(), BE.featuredBoss(), 'with no arg it is self-consistent for today')

  t.section('the roster and key guards stay in lockstep with the boss registry')
  t.eq(OP.bossOrder().join(','), 'elder-worm,storm-drake,void-maw', 'the rotation order matches BOSS_ORDER')
  t.eq(OP.bossRoster().length, 3, 'all three bosses are on the roster')
  t.eq(BE.validBoss('elder-worm'), 'elder-worm', 'a known key validates')
  t.eq(BE.validBoss('not-a-boss'), null, 'an unknown key is rejected')
  t.eq(BE.validBoss(123), null, 'a non-string key is rejected')

  t.section('a fresh profile ships an empty boss-event ledger')
  const p = freshProfile()
  t.deep(Object.keys(p.bossEvent.roster), [], 'no boss has progress yet')
  t.deep(Object.keys(p.bossEvent.weekly), [], 'no weekly result is stored yet')
  t.eq(BE.progress(p)['elder-worm'].normal, 0, 'progress reports zero normal tiers')
  t.eq(BE.eliteUnlocked(p, 'elder-worm'), false, 'elite starts locked before any normal tier')

  t.section('recording a normal win pays KP per newly-beaten tier')
  const q = freshProfile()
  const res = BE.recordResult(q, runLike('elder-worm', 2, true, false))
  t.ok(res, 'the run was recognised as a boss event')
  t.eq(res.newTiers, 2, 'both tiers were new')
  t.eq(res.tiersKilled, 2, 'the run reported two tiers killed')
  t.eq(res.kpEarned, 2 * BE.KP_NORMAL, 'KP is paid at the normal per-tier rate')
  t.eq(q.knowledgePoints, 2 * BE.KP_NORMAL, 'knowledgePoints landed on the profile')
  t.eq(q.bossEvent.roster['elder-worm'].normal.tiers, 2, 'the normal rack advances')
  t.eq(BE.eliteUnlocked(q, 'elder-worm'), true, 'one normal tier unlocks that boss elite')
  t.eq(BE.eliteUnlocked(q, 'storm-drake'), false, 'it does not unlock a different boss')

  t.section('beating fewer tiers later never backslides the rack')
  const r2 = BE.recordResult(freshProfile(), runLike('elder-worm', 4, true, false))
  t.eq(r2.newTiers, 4, 'all four were new on a clean profile')

  t.section('the weekly stamp ratchets best-of within a week')
  const w1 = freshProfile()
  BE.recordResult(w1, runLike('elder-worm', 2, true, false))
  const wkKey = BE.weekKey(new Date())
  t.eq(w1.bossEvent.weekly[wkKey].bestTier, 2, 'the week records the best tier so far')
  BE.recordResult(w1, runLike('elder-worm', 1, false, false))
  t.eq(w1.bossEvent.weekly[wkKey].bestTier, 2, 'a worse later attempt does not lower it')
  t.eq(w1.bossEvent.weekly[wkKey].won, true, 'a later leak cannot wipe an earlier win flag')
  BE.recordResult(w1, runLike('elder-worm', 5, true, false))
  t.eq(w1.bossEvent.weekly[wkKey].bestTier, 5, 'a better result raises it')

  t.section('elite runs pay their own rate and are gated')
  const e = freshProfile()
  const e0 = BE.recordResult(e, runLike('storm-drake', 1, true, true))
  t.eq(e0.kpEarned, 1 * BE.KP_ELITE, 'elite tiers pay the elite per-tier rate')
  t.eq(e.bossEvent.roster['storm-drake'].elite.tiers, 1, 'the elite rack advances')
  t.eq(BE.eliteUnlocked(e, 'storm-drake'), false, 'elite progress does not imply normal progress')

  t.section('a full clear pays a one-time bonus only once per boss')
  const fc = freshProfile()
  const first = BE.recordResult(fc, runLike('void-maw', 5, true, false))
  t.eq(first.fullClear, true, 'a five-tier win is flagged as a full clear')
  t.eq(first.kpEarned, 5 * BE.KP_NORMAL + BE.KP_FULL_CLEAR, 'the bonus stacks with the five tier points')
  const again = BE.recordResult(fc, runLike('void-maw', 5, true, false))
  t.eq(again.fullClear, false, 'already-cleared bosses pay no second bonus')
  t.eq(again.kpEarned, 0, 'no new tiers means no further KP')

  t.section('non-boss and invalid runs never touch the ledger')
  const noBoss = freshProfile()
  const nullRes = BE.recordResult(noBoss, { rules: {}, stats: { bossTiersKilled: 3 }, outcome: 'won' })
  t.eq(nullRes, null, 'a run with no boss key is not a boss event')
  const badBoss = BE.recordResult(freshProfile(), runLike('not-a-boss', 3, true, false))
  t.eq(badBoss, null, 'an unknown boss key is refused')
  const guarded = freshProfile()
  t.eq(BE.recordResult(freshProfile(), null), null, 'a null sim resolves safely')
  t.deep(Object.keys(noBoss.bossEvent.roster), [], 'the ledger stays clean after the guard')

  t.section('the reward constants are exported for callers')
  t.eq(BE.KP_NORMAL, 2, 'normal tier KP is 2')
  t.eq(BE.KP_ELITE, 3, 'elite tier KP is 3')
  t.eq(BE.KP_FULL_CLEAR, 5, 'the full-clear bonus is 5')
  t.eq(BE.DRAFT_NORMAL, 1, 'normal tiers pay one token each')
  t.eq(BE.DRAFT_ELITE, 2, 'elite tiers pay two tokens each')
  t.eq(BE.DRAFT_FULL_CLEAR, 2, 'a full clear pays a two-token bonus')

  t.section('newly-beaten tiers pay Draft Tokens onto the profile')
  let pd = freshProfile()
  let dr = BE.recordResult(pd, runLike('elder-worm', 2, true, false), undefined, new OP.RNG('draft-boss-1'))
  t.eq(dr.draftsEarned, 2, 'two new normal tiers earn exactly two tokens')
  t.ok(dr.draftsEarned > 0 && OP.Drafts.count(pd) === 2, 'the profile owns two tokens after the win')

  t.section('a full clear pays its bonus once, like KP')
  const fc2 = freshProfile()
  const fcFirst = BE.recordResult(fc2, runLike('void-maw', 5, true, false), undefined, new OP.RNG('draft-boss-2'))
  t.eq(fcFirst.draftsEarned, 5 * BE.DRAFT_NORMAL + BE.DRAFT_FULL_CLEAR, 'first clear counts tiers plus the bonus')
  const fcAgain = BE.recordResult(fc2, runLike('void-maw', 5, true, false), undefined, new OP.RNG('draft-boss-3'))
  t.eq(fcAgain.draftsEarned, 0, 'a repeat clear pays nothing more')

  t.section('elite tiers pay the elite token rate only for newly-beaten tiers')
  const fd = freshProfile()
  BE.recordResult(fd, runLike('storm-drake', 3, true, true), undefined, new OP.RNG('draft-boss-4'))
  t.eq(OP.Drafts.count(fd), 3 * BE.DRAFT_ELITE, 'three new elite tiers pay the elite rate')
  const fd2 = freshProfile()
  BE.recordResult(fd2, runLike('storm-drake', 2, true, true), undefined, new OP.RNG('draft-boss-5'))
  t.eq(OP.Drafts.count(fd2), 2 * BE.DRAFT_ELITE, 'an elite run pays tokens even while elite stays locked')

  t.section('a worse loss pays nothing for tiers already on the rack')
  const pl = freshProfile()
  const preWin = BE.recordResult(pl, runLike('elder-worm', 2, true, false), undefined, new OP.RNG('draft-boss-6'))
  t.eq(preWin.draftsEarned, 2, 'the win paid two tokens')
  const lr = BE.recordResult(pl, runLike('elder-worm', 1, false, false), undefined, new OP.RNG('draft-boss-7'))
  t.eq(lr.draftsEarned, 0, 'a worse loss pays nothing')
  t.eq(OP.Drafts.count(pl), 2, 'the earlier tokens are untouched')
}