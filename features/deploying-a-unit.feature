Feature: Deploying and rolling back one sub-app at a time
  As an operator
  I want to deploy a change to one sub-app without moving the others
  So that shipping one part of the page, and undoing it, does not drag four
  unrelated bundles with it

  # Every scenario here is @live. The whole claim is about what publish and
  # promote really do to the store, and a stub that reimplemented them could
  # pass while the real path was broken - which is the failure this suite
  # exists to catch.
  #
  # "build alpha" names a whole composition: five units, each carrying the
  # marker "alpha". A scenario that wants one unit to differ says so.

  Background:
    Given build "one" is published and promoted to the qa channel

  # The first of the three things this feature exists for.
  @live
  Scenario: Deploying one sub-app leaves the others where they were
    Given a new "alpha" unit is published
    When the operator promotes that "alpha" unit to the qa channel
    Then visitors to the qa origin receive the new "alpha" unit within the propagation window
    And the qa channel still serves build "one" for bravo, charlie, delta and the shell

  # The second. It is not implied by the first: a promote that replaced the
  # whole composition would pass the first scenario and fail this one.
  @live
  Scenario: Deploying a second sub-app leaves the first at its new version
    Given a new "alpha" unit is published
    And that "alpha" unit is already deployed to the qa channel
    And a new "bravo" unit is published
    When the operator promotes that "bravo" unit to the qa channel
    Then visitors to the qa origin receive the new "bravo" unit within the propagation window
    And the qa channel still serves the new "alpha" unit

  # The third, and the reason the compatibility check exists at all.
  @live
  Scenario: Rolling one sub-app back leaves the other at its newer version
    Given a new "alpha" unit is published
    And that "alpha" unit is already deployed to the qa channel
    And a new "bravo" unit is published
    And that "bravo" unit is already deployed to the qa channel
    When the operator promotes build "one"'s "alpha" unit to the qa channel
    Then visitors to the qa origin receive build "one"'s "alpha" unit within the propagation window
    And the qa channel still serves the new "bravo" unit

  # The page is assembled from directories that were written at different
  # times. Without this, a server that joined every file against one base would
  # pass every scenario above - the manifest would say the right ids - and
  # serve a page whose sub-apps 404.
  @live
  Scenario: Each unit's files are served from that unit's own directory
    Given a new "alpha" unit is published
    When the operator promotes that "alpha" unit to the qa channel
    Then each sub-app on the qa origin is fetched from its own unit's directory

  # Publishing has to skip what did not change, or "deploy one app" uploads
  # five directories and the independence is only in the pointer.
  @live
  Scenario: Publishing after a change to one sub-app uploads that sub-app alone
    When the operator builds and publishes with only "alpha" changed
    Then only the alpha unit is uploaded

  # Rolling one unit back is exactly how a combination nothing has ever
  # typechecked comes to be served, so the refusal is what makes the rollback
  # safe rather than merely possible.
  @live
  Scenario: A composition with no contract in common is refused
    Given a unit published against a contract the shell does not support
    When the operator promotes that unit to the qa channel
    Then the promotion is refused because no contract is shared
    And the qa channel still serves build "one" for every unit

  @live
  Scenario: Promoting an unpublished unit is refused
    When the operator promotes an "alpha" unit that was never published
    Then the promotion is refused because that unit is not published
    And the qa channel still serves build "one" for every unit
