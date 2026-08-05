export const name = 'audio'
export const needs = ['js/audio.js']

import { makeSim, spawn, hit, ticks } from './_fixture.mjs'

export function run (t, OP, env) {
  const A = OP.Audio

  // The harness stubs AudioContext (see makeAudioStub in tools/loadgame.mjs), so
  // the whole graph is exercisable headlessly. What we cannot test is how it
  // sounds; what we can test is everything that makes it break.

  function fresh () {
    A.stopMusic()
    A.state.ctx = null
    A.state.ready = false
    A.state.unlocked = false
    A.state.voices = 0
    A.state.suppressed = 0
    A.state.lastAt = {}
    A.state.muted = false
    A.cursors = { pop: 0, blast: 0, leak: 0, event: 0 }
    A.init()
    A.unlock()
    // The stub context's clock does not advance on its own, so drive it by hand.
    A.state.ctx.currentTime = 0
    return A.state
  }

  /* ---------- lifecycle ---------- */

  t.section('nothing exists before init')
  A.stopMusic()
  A.state.ctx = null
  A.state.unlocked = false
  t.notOk(A.isReady(), 'not ready before init')
  t.eq(A.play('pop'), false, 'playing before init is a silent no-op, not a crash')

  t.section('init builds the graph exactly once')
  const ctx1 = A.init()
  t.ok(ctx1, 'init returns a context')
  t.eq(A.init(), ctx1, 'a second init returns the same context rather than a second graph')
  t.ok(A.state.master && A.state.sfxBus && A.state.musicBus && A.state.comp,
    'master, sfx bus, music bus and limiter all exist')

  t.section('audio stays silent until a user gesture unlocks it')
  A.state.unlocked = false
  t.notOk(A.isReady(), 'a context without a gesture is not ready')
  t.eq(A.play('pop'), false, 'and plays nothing — browsers would drop it anyway')
  t.ok(A.unlock(), 'unlock succeeds')
  t.ok(A.isReady(), 'and now it is ready')

  /* ---------- the sound bank ---------- */

  t.section('the sound bank')
  const keys = A.keys()
  t.gt(keys.length, 12, `${keys.length} sounds are registered`)
  for (const want of ['pop', 'blimpPop', 'shoot', 'explode', 'place', 'upgrade', 'sell',
    'deny', 'leak', 'roundStart', 'roundEnd', 'ability', 'levelUp', 'gameOver', 'victory']) {
    t.ok(A.has(want), `"${want}" is defined`)
  }
  t.notOk(A.has('no-such-sound'), 'an undefined key reports false')

  t.section('every registered sound schedules without throwing')
  let broke = []
  for (const key of keys) {
    const S = fresh()
    S.ctx.currentTime = 1
    try { A.play(key) } catch (e) { broke.push(key + ': ' + e.message) }
  }
  t.eq(broke.length, 0, broke.length ? 'these threw: ' + broke.join(' / ') : `all ${keys.length} sounds built a graph cleanly`)

  t.section('an unknown sound is refused rather than throwing')
  fresh()
  t.eq(A.play('nonsense'), false, 'play returns false')

  /* ---------- the voice limiter: the part that actually matters ---------- */

  t.section('a burst of the SAME sound in one instant collapses to one voice')
  // Six reds popping on one tick must sound like one pop. Without this the graph
  // accumulates nodes, the audio thread starves, and it presents as the GAME
  // being slow — which is a genuinely misleading bug.
  let S = fresh()
  S.ctx.currentTime = 5
  let played = 0
  for (let i = 0; i < 40; i++) if (A.play('pop', { size: 0.3 })) played++
  t.eq(played, 1, 'forty simultaneous identical pops schedule exactly one')
  t.eq(S.suppressed, 39, 'and the other 39 are counted as suppressed')

  t.section('the same sound plays again once enough time has passed')
  S.ctx.currentTime = 5.5
  t.ok(A.play('pop', { size: 0.3 }), 'a later pop is allowed')

  t.section('different sounds in the same instant are not collapsed into each other')
  S = fresh()
  S.ctx.currentTime = 9
  t.ok(A.play('pop'), 'pop plays')
  t.ok(A.play('explode'), 'and explode plays in the same instant')
  t.ok(A.play('leak'), 'and leak too')

  t.section('the hard voice cap holds')
  S = fresh()
  let allowed = 0
  for (let i = 0; i < 200; i++) {
    // Advance the clock so the same-sound gap never trips, isolating the cap.
    S.ctx.currentTime = 20 + i * 0.5
    if (A.play('pop')) allowed++
  }
  t.lte(allowed, 200, 'sanity')
  // Voices are only released by onended, which the stub never fires, so once the
  // cap is reached everything after it must be refused.
  t.lte(S.voices, 20, `voices never exceed the cap (peaked at ${S.voices})`)
  t.gt(S.suppressed, 0, 'and the excess was suppressed rather than queued')

  t.section('a thousand pops in one round cannot grow the graph without bound')
  S = fresh()
  for (let i = 0; i < 1000; i++) {
    S.ctx.currentTime = 100 + i * 0.001
    A.play('pop')
  }
  t.lte(S.voices, 20, `still capped after a thousand attempts (${S.voices} voices)`)

  /* ---------- volume and mute ---------- */

  t.section('volumes')
  fresh()
  A.setSfxVolume(0.25)
  t.close(A.state.sfxBus.gain.value, 0.25, 1e-9, 'sfx volume reaches the bus')
  A.setMusicVolume(0.5)
  t.close(A.state.musicBus.gain.value, 0.5, 1e-9, 'music volume reaches the bus')
  A.setSfxVolume(9)
  t.eq(A.state.sfxVolume, 1, 'volume clamps above 1')
  A.setSfxVolume(-3)
  t.eq(A.state.sfxVolume, 0, 'and below 0')

  t.section('mute')
  S = fresh()
  A.setMuted(true)
  t.eq(S.master.gain.value, 0, 'muting silences the master bus')
  S.ctx.currentTime = 200
  t.eq(A.play('pop'), false, 'and nothing is scheduled while muted')
  A.setMuted(false)
  t.eq(S.master.gain.value, 1, 'unmuting restores it')
  S.ctx.currentTime = 201
  t.ok(A.play('pop'), 'and sound resumes')

  /* ---------- music ---------- */

  t.section('music')
  fresh()
  t.ok(A.startMusic('calm'), 'a music bed starts')
  t.eq(A.debug().music, 'calm', 'and reports its mood')
  t.ok(A.startMusic('boss'), 'switching mood restarts it')
  t.eq(A.debug().music, 'boss', 'to the new mood')
  A.stopMusic()
  t.eq(A.debug().music, null, 'and it stops')
  t.noThrow(() => A.stopMusic(), 'stopping twice is safe')

  t.section('an unknown mood falls back rather than failing')
  fresh()
  t.ok(A.startMusic('not-a-mood'), 'it still starts')
  A.stopMusic()

  t.section('music will not start before a gesture')
  A.stopMusic()
  A.state.unlocked = false
  t.eq(A.startMusic('calm'), false, 'refused')

  /* ---------- driving it from the sim ---------- */

  t.section('sim events drive playback')
  S = fresh()
  let sim = makeSim(OP, { trackLength: 600, cash: 0 })
  const b = spawn(OP, sim, 'pink', 100)
  hit(OP, sim, b, 5)
  t.gt(sim.popEvents.length, 0, 'the sim recorded pops')
  S.ctx.currentTime = 300
  t.noThrow(() => A.consume(sim), 'consuming the queues does not throw')
  t.eq(A.cursors.pop, sim.popEvents.length, 'the pop cursor advanced to the end of the queue')

  t.section('consuming twice does not replay the same events')
  const suppressedBefore = S.suppressed
  const voicesBefore = S.voices
  A.consume(sim)
  t.eq(A.cursors.pop, sim.popEvents.length, 'the cursor is unchanged')
  t.eq(S.voices, voicesBefore, 'and nothing new was scheduled')
  t.eq(S.suppressed, suppressedBefore, 'not even a suppressed attempt')

  t.section('a blimp pop uses the bigger sound')
  S = fresh()
  sim = makeSim(OP, { trackLength: 600 })
  const blimp = spawn(OP, sim, 'goliath', 100)
  hit(OP, sim, blimp, 99999)
  S.ctx.currentTime = 400
  A.consume(sim)
  t.ok(S.lastAt.blimpPop !== undefined, 'blimpPop was the sound chosen for a GOLIATH')

  t.section('cursors keep up while muted, so unmuting does not dump a banked round')
  S = fresh()
  A.state.unlocked = false
  sim = makeSim(OP, { trackLength: 400 })
  for (let i = 0; i < 5; i++) hit(OP, sim, spawn(OP, sim, 'pink', 50 + i * 10), 5)
  A.consume(sim)
  t.eq(A.cursors.pop, sim.popEvents.length, 'the cursor tracked the queue even though nothing played')
  t.eq(S.voices, 0, 'and no voice was used')

  t.section('a trimmed queue resyncs instead of replaying stale events')
  S = fresh()
  sim = makeSim(OP, { trackLength: 600 })
  hit(OP, sim, spawn(OP, sim, 'pink', 100), 5)
  A.consume(sim)
  // Simulate the sim's queue cap trimming from the front.
  sim.popEvents.length = 0
  t.noThrow(() => A.consume(sim), 'a shorter queue than the cursor does not throw')
  t.eq(A.cursors.pop, 0, 'and the cursor resyncs to the new length')

  t.section('game-over and victory both have a sound')
  S = fresh()
  sim = makeSim(OP, { lives: 1 })
  OP.Economy.endGame(sim, 'leaked')
  S.ctx.currentTime = 500
  A.consume(sim)
  t.ok(S.lastAt.gameOver !== undefined, 'a loss plays gameOver')

  S = fresh()
  sim = makeSim(OP, {})
  OP.Economy.endGame(sim, 'won')
  S.ctx.currentTime = 600
  A.consume(sim)
  t.ok(S.lastAt.victory !== undefined, 'a win plays victory')

  /* ---------- audio must not be able to affect the simulation ---------- */

  t.section('audio cannot influence the simulation')
  const withAudio = makeSim(OP, { trackLength: 2000, seed: 'aud' })
  const without = makeSim(OP, { trackLength: 2000, seed: 'aud' })
  fresh()
  for (let i = 0; i < 200; i++) {
    if (i % 7 === 0) {
      spawn(OP, withAudio, 'green', 0)
      spawn(OP, without, 'green', 0)
    }
    OP.Sim.step(withAudio)
    OP.Sim.step(without)
    A.state.ctx.currentTime = i * 0.0167
    A.consume(withAudio)          // only one of the two has its queues consumed
  }
  t.eq(OP.Sim.checksum(withAudio), OP.Sim.checksum(without),
    'consuming the audio queues every tick leaves the simulation bit-identical')

  t.section('audio survives being fed a sim with nothing in it')
  fresh()
  const empty = makeSim(OP, {})
  t.noThrow(() => A.consume(empty), 'an empty sim is fine')

  /* ---------- diagnostics ---------- */

  t.section('debug reporting')
  fresh()
  const dbg = A.debug()
  t.ok(dbg.ready, 'reports ready')
  t.ok(dbg.unlocked, 'reports unlocked')
  t.eq(dbg.sounds, keys.length, 'reports the bank size')
  t.eq(typeof dbg.voices, 'number', 'reports live voices')
  t.eq(typeof dbg.suppressed, 'number', 'reports suppressed count')

  t.section('no audio state leaked into the global scope')
  // The loader suite covers this repo-wide, but a WebAudio file is the most
  // likely place for a stray top-level `const ctx`.
  t.ok(typeof env.ctx.ctx === 'undefined', 'no bare `ctx` global')
  t.ok(typeof env.ctx.master === 'undefined', 'no bare `master` global')

  // Leave the module in a clean state for any suite that runs after this one.
  A.stopMusic()
  A.setMuted(false)
}
