Step 1: a second unit. `list` is published and promoted on its own, and `/` stops being an empty view.

This is the first record in the archive of a unit arriving. `list` reads `new` in
`promote.json` because the composition it went into held no `list` at any id -
`from` is null, which is a different fact from `moved`, where the channel served
something before. Nothing else has produced that state: every earlier record is
`carried`, `moved`, or the one `dropped` that removed `hello` yesterday.

The shell moved too, from `5442c052` to `e27ad5ff`, because placement lives in
the shell: `/` names `list`, and a route gaining a unit is a shell change. That
is the price `PLAN.md` accepts for the manifest naming bundles and choosing
nothing, and it is why this promote is two units rather than one.

What the pictures show. `/` draws the panel: an input, an Add button, "No tasks
yet", and the line that says the tasks are kept in this page alone and a reload
starts again with none. That sentence is `PLAN.md` step 1's own limit said on the
page rather than left for a visitor to discover, and step 2 is what changes it.
`/board` and `/week` still say no unit is placed there yet; `/service` and
`/backup` are drawn by the frame from its own state. Four of the five views
fetch nothing, and the `@browser` walk counts that rather than believing it.

Contract `15ed669`, minted for this step. It is the first promote on a contract
that is not `9d1b0a3`.
