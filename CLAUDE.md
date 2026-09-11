# Working rules for this repository

`README.md` is the design and the reasoning. `PLAN.md` is what is being built and in what order. `TODO.md` is what is open. This file is how work gets done, and it is short on purpose.

## Every change goes through a pull request

No commit lands on `main` except by merging a pull request. That includes a one-line fix, a typo, and a change to this file.

```sh
git checkout -b <branch>
# work, commit
git push -u origin <branch>
gh pr create                 # the template is .github/pull_request_template.md
bun run pr                   # fills in the review URLs and both sets of shots
```

`bun run pr` is not optional decoration. It builds the branch with `BUILD_MARKER=pr-<number>`, publishes it, shoots the preview through the deployed origin, and puts two links and two columns of pictures in the body. A reviewer then reads what changed on the page rather than a description of it.

It refuses to run when the newest `deploys/` record disagrees with what `qa` serves, because that record is the production column. Run `bun run shoot` and commit the record first.

## What the harness may do here

`.claude/settings.json` allows `gh pr view|list|diff|checks|create|edit|review|merge` without a prompt. Without those rules the auto-mode classifier refuses every one of them, the read-only ones included. It does **not** allow `gh api`: `Bash(gh api repos/*)` is prefix-matched, so it would have covered `gh api repos/OWNER/REPO -X DELETE` and every other write to the repository object.

`gh pr merge` is in that list, so a session can merge to `main` with no prompt - including a session that wrote the code it is merging. The pull request is still the unit of change; it is not, by itself, a second pair of eyes. Where that matters, send the branch to `devils-advocate-agent` or run `/code-review` first: both read the change in their own context rather than sharing the reasoning that produced it.

## The pictures are the record

`deploys/<composedAt>-<channel>/` is what was **served**. `promote` opens it on a real channel - the act, and the pointer bytes it PUT - and prints the `bun run shoot --out <dir>` line that fills in the pictures. `previews/pr-<n>/` is what a branch **would** serve, and no channel ever pointed at it. They are separate directories because they are separate claims.

Nothing regenerates a shot. A picture of what was served on a date is falsified by re-shooting it.

`bun run changelog` gathers `deploys/` into `CHANGELOG.md`, which is generated, never hand-edited, and **not committed** - it is gitignored. Every fact in it is already in `deploys/`, which is committed, so a copy in git would only add a file that goes stale, a check to catch that, and a merge conflict whenever two branches each land a deploy. Run the command when you want to read the archive.

## Before a pull request is ready

| | |
| --- | --- |
| `bun run typecheck` | |
| `bun test` | 689 tests on 2026-09-11 |
| `bun run verify` | the `@local` suite |
| `bun run falsify` | when the change adds or moves a check |
| `bun run verify:live` | when the change touches the store, the pointer or the server |

Green checks do not prove a feature works. `~/projects/CLAUDE.md` carries the reasoning; the short form is that a suite which wires the stack by hand can pass while the path a visitor takes is broken, and this repository has `bun run e2e` because of it.

`bun run e2e` and `bun run e2e:members` measure a sub-app, so both refuse to run when the tree builds none. `PLAN.md` step 1 builds `list` and both pass again. Run them when a change touches a unit, the contract surface or `promote`; TODO §31 lists what is still waiting for a third unit.

## Voice

Commit messages, pull request descriptions and code comments are Robot-voice: terse, factual, structured, no metaphor. Their reader is a person in `git log` at 2 a.m., not a reader of an essay.

A `.feature` file is the requirement. Prose in `README.md` explains why a mechanism exists and what it refuses to do; it does not paraphrase a scenario.
