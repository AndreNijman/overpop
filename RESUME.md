# Pausing and resuming this build

This build is a state machine, not a conversation. Nothing needed to continue it
lives in a chat log — it is all on disk, in git, and verifiable.

**To pick up from a cold start (new session, new machine, or you by hand):**

```sh
cd ~/Projects/bloons/overpop
node tools/state.mjs brief
```

That prints what the project is, how far it got, what was in flight when it
stopped, and what to do next. Nothing else needs to be read first.

## Why it works

`BUILD_STATE.json` holds every step of the build, and each step carries:

| Field | Purpose |
|---|---|
| `deps` | Which steps must be `done` first. The graph is checked acyclic by `selftest`. |
| `produces` | The files the step must leave on disk. Existence is checkable. |
| `verify` | Shell commands that prove the step actually works — usually a harness suite. |
| `status` | `todo` / `in_progress` / `done` / `blocked` |
| `commit` | The git SHA the step landed in, stamped automatically. |
| `note` | Constraints and gotchas for whoever does the step. |

Progress is therefore *derived from evidence*, not asserted. A step is only
`done` if its verify commands pass — `state.mjs done` refuses otherwise, and if
you override with `--force` it records the override in the step's note and in the
build log, so a forced step can never masquerade as a clean one.

## The loop

```sh
node tools/state.mjs next            # what can I start? (shows parallelisable steps)
node tools/state.mjs start P1.3      # mark in flight
#   ... write the code ...
node tools/state.mjs verify P1.3     # does it actually work?
git add -A && git commit -m "feat(core): balloon layer model and child cascade"
node tools/state.mjs done P1.3       # re-verifies, stamps the commit, shows what's next
```

One commit per step, so `git log` and `BUILD_STATE.json` tell the same story.
`docs/BUILD_LOG.md` is an append-only transcript of every transition.

## Pausing mid-step

Safe at any moment. A step left `in_progress` is reported at the top of `brief`
with its full spec — deps, expected outputs, verify commands, and notes — so the
work can be reconstructed without guessing. If you want to leave yourself
something more specific:

```sh
node tools/state.mjs note P1.3 "child cascade done; regen timers still TODO"
```

Interrupted work is not lost work: commit the partial state on the branch, leave
the step `in_progress`, and the next session resumes from the note plus the diff.

## Checking the whole thing still holds

```sh
node tools/state.mjs selftest    # is the state file itself coherent?
node tools/state.mjs verify all  # do all completed steps still pass?
node tools/harness.mjs --all     # full game verification suite
```

`verify all` is the one that matters after a long pause — it catches steps that
were genuinely done but got broken by later work, which is exactly the failure a
checklist of ticked boxes hides.

## If a step can't be finished

Mark it, don't quietly skip it:

```sh
node tools/state.mjs block P11.7 "needs Andre's go-ahead after he's played it"
```

Blocked steps show up in `brief` and `next` under a heading that says a human has
to decide something. `P11.7` (the portfolio card) ships blocked on purpose.
