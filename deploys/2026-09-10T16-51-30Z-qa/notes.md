A no-op promote to eu alone, made to verify that a record says which reading each manifest is.

The composition did not change: `--shell c2601912 --app hello=3bba892b` is what qa already
served. `--region eu` wrote one region, so `manifest.eu.json` holds the bytes this promote PUT
and `manifest.us.as-served.json` holds what the store answered for a region this promote did not
write - a different deploy's pointer, under a name that says so.
