The rollback that was impossible an hour earlier: `--app` naming a unit this tree no longer builds.

`qa` already served `hello 3bba892b`, so nothing moved. What is being verified is that the command
runs at all. Before this, `--app` validated its name against `APPS`, which step 0 empties, so the
only way back from a bad promote was editing `scripts/contract.ts` and promoting from a dirty tree
- which is what `deploys/2026-09-10T21-15-37Z-qa/promote.json` records, `dirtyPaths` and all.

A promote now composes from the channel's own apps as well as this tree's, so a unit the tree
stopped building is carried rather than silently dropped, and `--drop` is the only way one leaves.
