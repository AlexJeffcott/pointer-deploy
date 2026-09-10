A no-op promote to qa, made to verify the record path after the write was refactored.

The composition did not change. It is the first record written by `writeRecord`, which now runs
from a `catch` as well as from the ordinary path, takes the next free directory name rather than
overwriting a record made in the same second, and records the regions whose pointer actually
landed rather than the ones the run asked for.

Four of the five records in `deploys/` are now verification traffic. §34 carries that.
