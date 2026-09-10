A promote that carried both units and moved neither: the first record `promote` wrote of itself.

Written by hand. The first line is the entry in the changelog, so it says what
this promote demonstrates rather than what it changed - the ids beside it already
say what changed.

`promote.json` is the act. `qa` was promoted to the two ids it already served, so
the composition is unchanged and the pointer was rewritten to what it was - which
is what makes this a reading of the record rather than of a deploy. Both units
read `carried`, `warnings` is empty, and `source` is the commit that ran it with a
clean tree.

The pictures were filled in by the `bun run shoot --out <dir>` line that promote
printed. `manifest.eu.json` and `manifest.us.json` are the bytes promote PUT, and
they were checked against what the store served afterwards: identical, both
regions.
