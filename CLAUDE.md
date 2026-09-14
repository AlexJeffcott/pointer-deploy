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
| `bun test` | 835 tests on 2026-09-13 |
| `bun run verify` | the `@local` suite |
| `bun run verify:browser` | the `@browser` suite. **The only command that runs a sub-app's scenarios** |
| `bun run falsify` | when the change adds or moves a check. `FALSIFY_LIVE=1` for the 64 `@live` and `@browser` mutations of the 175, which it otherwise reports as skipped |
| `bun run verify:live` | when the change touches the store, the pointer or the server |
| `bun run verify:cold` | when the change touches `features/support/cold-planner.ts`, `usePage`, or `playwright.config.ts`. Two pages in one browser context, and it drives `list`'s controls on the deployed origin - it refuses when the composition places no `list` |
| `bun run verify:split` | when the change touches `splitChannelReport` or `refuseSplitChannels`. It splits `test-prod`, reads the report, runs the command the report printed, and puts the channel back in a `finally` |
| `bun run verify:keys` | when the change touches which bucket a key is used against. It aims the snapshot key at `pointer-deploy-assets` and requires 403 on the write and the delete. Half of `PLAN.md` step 6's security argument |
| `bun run e2e:snapshots` | when the change touches `api/`, the shell's client or the pull door. It drives the DEPLOYED service: a planner in, the same planner out at the address it was given, and the public asset origin refusing to serve it. Nothing else in the tree writes a byte to Tigris through the service - the unit tests use `memoryStore` and the @local scenarios spawn a service with no credential |

`verify:browser` is in that table from 2026-09-11 and was missing before it. Every scenario in `keeping-a-list-of-tasks.feature`, `moving-a-task-between-columns.feature` and `seeing-the-week.feature` is `@browser @test-channel`, and so is `Moving between views draws each one and fetches nothing` — which carries the whole per-view half of `PLAN.md` step 0's claim. `verify` runs `@local` and `verify:live` runs `@live`, so neither reaches any of them: the requirement a step ships is written in a file the documented gate never opened.

`bun run falsify` runs the `@local` mutations alone and REPORTS the rest as skipped. A count of mutations in the array is not a count of mutations that ran; `--only <text>` narrows a run so a claim about a few of them can be measured without running all 175, and it may be given more than once. A count of mutations is also not a count of scenarios covered: `runScenario` greps the scenario a mutation NAMES, so eight of the sixteen scenarios in `seeing-the-week.feature` have no mutation behind them and nothing in the run says so.

**And a mutation whose check cannot be LOADED reads as caught.** `runUnitTest` spawned `bun test src/server src/web scripts` while `package.json` names five homes, so three mutations aimed at `features/support/__tests__/` on 2026-09-13 ran against a `bun test` that could not find their tests: bun exits 1 with `matched 0 tests`, which is not `code === 0`, and falsify counted them caught. `TEST_HOMES` in `falsify.ts` is the list and it must stay the same five. The guard beneath it catches both of bun's wordings for a filter that matched nothing, and it is the §35 trap reached from the other side - a check that never ran, reported as a check that went red.

**Run one suite at a time.** `falsify`, `verify`, `verify:live` and `verify:browser` regenerate `.features-gen/`, so two of them at once rewrite each other's spec files. (`verify:cold` and `verify:split` are plain scripts and touch no spec file; a sentence here said every `verify:*` until the two of them were added on 2026-09-13.) Measured on 2026-09-13: a `verify:live` run with `falsify` started under it reported 9 failed of 19, every one of them `Cannot find module '.../<feature>.feature.spec.js'`, `ENOENT` on a spec, or `Test not found in the worker process`. None of it was about the code, and the same tree passed when the run had the directory to itself. The same rule already applies to `dist/`, which `e2e`, `e2e:members`, `verify:live` and `falsify` all overwrite.

Green checks do not prove a feature works. `~/projects/CLAUDE.md` carries the reasoning; the short form is that a suite which wires the stack by hand can pass while the path a visitor takes is broken, and this repository has `bun run e2e` because of it.

`bun run e2e` and `bun run e2e:members` measure a sub-app, so both refuse to run when the tree builds none. `PLAN.md` step 1 builds `list` and both pass again; step 4 builds `board` and step 5 builds `week`. Run them when a change touches a unit, the contract surface or `promote`; a change to the unit COUNT touches them too - `e2e:members` had step 1's count written in as a literal and failed on a correct composition at step 4. TODO §31 lists what is still waiting.

`bun run measure:preload` measures what warming an off-screen unit buys, with a control: it strips the warm tags out of the HTML on the way to the browser and takes every reading twice. There are two off-screen units from `PLAN.md` step 5, so `--unit <name>` says which one; it defaults to `board`, which every earlier reading was taken against. Run it when a change touches the preload tags, the loader or placement. It publishes and points `test-qa` at what it published, and leaves it there.

## Voice

Commit messages, pull request descriptions and code comments are Robot-voice: terse, factual, structured, no metaphor. Their reader is a person in `git log` at 2 a.m., not a reader of an essay.

A `.feature` file is the requirement. Prose in `README.md` explains why a mechanism exists and what it refuses to do; it does not paraphrase a scenario.
