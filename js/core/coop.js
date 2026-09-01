/**
 * COOP — hot-seat tag-team mode.
 *
 * Two players share the same sim, alternating turns between rounds.
 * Each player has their own cash pool; lives, towers and the map are shared.
 * The active player can place towers and use abilities during their turn.
 * Between rounds the game pauses and shows a turn-swap overlay.
 *
 * Architecture: coop is a thin layer on top of the existing sim. The sim
 * itself knows nothing about coop — it sees a normal rules object and a
 * normal cash value. Coop intercepts round-end to swap the cash pool and
 * pauses the sim during the swap overlay.
 */
;(function () {
  'use strict'

  const Coop = {}

  /**
   * Initialise coop state on a sim. Called from Sim.create when rules.coop
   * is true.
   *
   * @param {Object} sim  the live sim
   */
  Coop.init = function (sim) {
    if (!sim.rules || !sim.rules.coop) return
    sim.coop = {
      active: 0,             // 0 or 1
      players: [
        { cash: sim.rules.startCash || 650 },
        { cash: sim.rules.startCash || 650 }
      ],
      swapping: false,       // true during the turn-swap overlay
      swapTimer: 0           // seconds remaining on the overlay
    }
    sim.cash = sim.coop.players[0].cash
  }

  /**
   * Swap the active player. Called at round end.
   *
   * @param {Object} sim  the live sim
   */
  Coop.swap = function (sim) {
    if (!sim.coop) return
    // Save current player's cash
    sim.coop.players[sim.coop.active].cash = sim.cash
    // Switch
    sim.coop.active = sim.coop.active === 0 ? 1 : 0
    // Load new player's cash
    sim.cash = sim.coop.players[sim.coop.active].cash
    // Show the swap overlay for two seconds of wall time.
    sim.coop.swapping = true
    sim.coop.swapTimer = 2
    sim.paused = true
  }

  /**
   * Advance the swap overlay timer. Called from Sim.advance even while paused.
   * When the timer expires, unpause and resume.
   *
   * @param {Object} sim  the live sim
   */
  Coop.advance = function (sim, wallDt) {
    if (!sim.coop || !sim.coop.swapping) return
    sim.coop.swapTimer -= Math.min(Math.max(0, wallDt || 0), 0.25)
    if (sim.coop.swapTimer <= 0) {
      sim.coop.swapping = false
      sim.paused = false
    }
  }

  /**
   * Is this sim in coop mode?
   *
   * @param {Object} sim
   * @returns {boolean}
   */
  Coop.active = function (sim) {
    return !!(sim && sim.coop)
  }

  /**
   * Can the current player place a tower? In coop, only the active player
   * can place during their turn. During the swap overlay, no one can place.
   *
   * @param {Object} sim
   * @returns {boolean}
   */
  Coop.canPlace = function (sim) {
    if (!sim.coop) return true
    if (sim.coop.swapping) return false
    return true // active player can place
  }

  /**
   * Summary for the HUD.
   *
   * @param {Object} sim
   * @returns {Object|null}
   */
  Coop.summary = function (sim) {
    if (!sim.coop) return null
    return {
      active: sim.coop.active,
      cash0: sim.coop.active === 0 ? sim.cash : sim.coop.players[0].cash,
      cash1: sim.coop.active === 1 ? sim.cash : sim.coop.players[1].cash,
      swapping: sim.coop.swapping,
      swapTimer: sim.coop.swapTimer
    }
  }

  Coop.serialize = function (sim) {
    if (!sim.coop) return null
    return {
      active: sim.coop.active,
      players: [
        { cash: sim.coop.active === 0 ? sim.cash : sim.coop.players[0].cash },
        { cash: sim.coop.active === 1 ? sim.cash : sim.coop.players[1].cash }
      ],
      swapping: sim.coop.swapping,
      swapTimer: sim.coop.swapTimer
    }
  }

  Coop.restore = function (sim, snap) {
    if (!sim.coop || !snap) return sim.coop
    sim.coop.active = snap.active === 1 ? 1 : 0
    for (let i = 0; i < 2; i++) {
      const cash = snap.players && snap.players[i] ? snap.players[i].cash : sim.coop.players[i].cash
      sim.coop.players[i].cash = typeof cash === 'number' && isFinite(cash) && cash >= 0 ? cash : 0
    }
    // A resumed run starts ready for the named player rather than trapping them
    // behind an overlay whose wall-clock origin was not saved.
    sim.coop.swapping = false
    sim.coop.swapTimer = 0
    sim.paused = false
    sim.cash = sim.coop.players[sim.coop.active].cash
    return sim.coop
  }

  OP.Coop = Coop
})()
