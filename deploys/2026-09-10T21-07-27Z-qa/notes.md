The first promote this project has written that no visitor was ever served: the deployed image refuses a composition naming no sub-app.

Written by hand, and there are no pictures because there was nothing to
photograph. `bun run shoot` refused, correctly:

    FAILED / still served hello=3bba892b shell=c2601912 ... after 45000 ms;
    this run asked for shell=5442c052. Nothing was written: a shot of one
    composition filed under another is the error this refuses.

What happened. `PLAN.md` step 0 takes the application to one unit, so this
promote wrote a pointer whose `apps` is `{}`. `parseComposition` in the image
running at the time threw `manifest names no apps` on it - a guard this branch
removes, on a schema-3 composition, for exactly this reason. The origin did what
it is built to do: kept the last manifest it could read, went on serving the
previous composition, and put the reason in `x-manifest-refresh`.

What it cost. `ams` was up and kept serving. `iad` was suspended; waking it
primed the cache against a pointer it could not parse, and it answered **503**
to every request for its region until the pointer was put back. Measured, not
inferred: three requests with `fly-prefer-region: iad`, all 503, with
`x-manifest-refresh: manifest names no apps` on each.

`deploys/2026-09-10T21-15-37Z-qa` is the promote that put a servable pointer
back, and it is the composition that is live.

The reading this record exists for: **a promote can write a pointer the running
image cannot parse, and nothing refuses it.** The shell-to-server surface has a
gate, §11, and the pointer-to-server surface has none. TODO §36.
