Feature: Publishing a build
  As an operator
  I want a published build to be immutable and permanent
  So that a page loaded before a deploy can still fetch the files it needs

  @live
  Scenario: A build's files may be cached indefinitely
    Given build "alpha" is published
    When a visitor fetches a file of build "alpha"
    Then the file is marked as safe to cache indefinitely

  # NoDangling, in the form a visitor experiences it: a tab opened before the
  # deploy, lazily fetching one of its files after it.
  @live
  Scenario: An earlier build's files remain available after a newer build is promoted
    Given build "alpha" is published
    And build "beta" is published and promoted to the qa channel
    When a page loaded from build "alpha" requests one of its files
    Then the file is served

  # The document and the bundle are on different origins by design, and a
  # cross-origin module script is fetched in CORS mode. Without this the page
  # renders empty while curl, the unit tests and every server-side check stay
  # green - which is exactly what happened the first time this was deployed.
  @live
  Scenario: A browser is allowed to load a build's script from the store
    Given build "alpha" is published
    When a browser on the qa origin requests the script of build "alpha"
    Then the store permits that origin to use it

  # A promotion that leaves the first visitor waiting on a cold store has not
  # finished. Warming is also what stops that wait showing up as a flaky test.
  @live
  Scenario: Every file a promoted build names is fetchable
    Given build "alpha" is published and promoted to the qa channel
    Then every file that build names can be fetched

  # A unit id is a hash of that unit's own output, so republishing unchanged
  # bytes is a skip and not an error. It has to be: publishing after a change
  # to one app is the common case, and the other four are unchanged then too.
  @live
  Scenario: Republishing a build that has not changed uploads nothing
    Given build "alpha" is published
    When the operator publishes build "alpha" again
    Then no unit is uploaded, because none of them changed

  # Why publish writes the manifest last, and why publish and promote are two
  # commands rather than one.
  @live
  Scenario: A channel cannot point at a build whose upload did not finish
    Given a publish of build "delta" is interrupted after some files are uploaded
    When the operator promotes build "delta" to the qa channel
    Then the promotion is refused because build "delta" has no manifest
