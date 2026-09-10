A no-op promote to both regions, made to verify that a record names what made the tree dirty.

The composition did not change. Its `source.dirtyPaths` names the previous record, which was
uncommitted when this ran: the tree was dirty because of a deploy record, not because of source,
and `dirty: true` alone could not say that. It also put eu and us back on one `composedAt` after
the single-region promote above.
