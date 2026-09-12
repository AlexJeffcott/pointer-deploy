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
| `bun test` | 736 tests on 2026-09-12 |
| `bun run verify` | the `@local` suite |
| `bun run verify:browser` | the `@browser` suite. **The only command that runs a sub-app's scenarios** |
| `bun run falsify` | when the change adds or moves a check. `FALSIFY_LIVE=1` for the 49 `@live` and `@browser` mutations of the 146, which it otherwise reports as skipped |
| `bun run verify:live` | when the change touches the store, the pointer or the server |

`verify:browser` is in that table from 2026-09-11 and was missing before it. Every scenario in `keeping-a-list-of-tasks.feature` is `@browser @test-channel`, and so is `Moving between views draws each one and fetches nothing` — which carries the whole per-view half of `PLAN.md` step 0's claim. `verify` runs `@local` and `verify:live` runs `@live`, so neither reaches any of them: the requirement a step ships is written in a file the documented gate never opened.

`bun run falsify` runs the `@local` mutations alone and REPORTS the rest as skipped. A count of mutations in the array is not a count of mutations that ran; `--only <text>` narrows a run so a claim about a few of them can be measured without running all 146.

Green checks do not prove a feature works. `~/projects/CLAUDE.md` carries the reasoning; the short form is that a suite which wires the stack by hand can pass while the path a visitor takes is broken, and this repository has `bun run e2e` because of it.

`bun run e2e` and `bun run e2e:members` measure a sub-app, so both refuse to run when the tree builds none. `PLAN.md` step 1 builds `list` and both pass again, and step 4 builds `board`. Run them when a change touches a unit, the contract surface or `promote`; a change to the unit COUNT touches them too - `e2e:members` had step 1's count written in as a literal and failed on a correct composition at step 4. TODO §31 lists what is still waiting.

`bun run measure:preload` measures what warming an off-screen unit buys, with a control: it strips the warm tags out of the HTML on the way to the browser and takes every reading twice. Run it when a change touches the preload tags, the loader or placement. It publishes and points `test-qa` at what it published, and leaves it there.

## Voice

Commit messages, pull request descriptions and code comments are Robot-voice: terse, factual, structured, no metaphor. Their reader is a person in `git log` at 2 a.m., not a reader of an essay.

A `.feature` file is the requirement. Prose in `README.md` explains why a mechanism exists and what it refuses to do; it does not paraphrase a scenario.
