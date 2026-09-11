Feature: Deploying and rolling back one unit at a time
  As an operator
  I want to deploy a change to one unit without moving the others
  So that shipping one part of the page, and undoing it, does not drag
  unrelated bundles with it

  Every scenario here is a sentence about two units, so every one of them lost
  its subject when `PLAN.md` step 0 took the tree to the frame alone. Step 1
  builds `list` and they are restored against it. What they read is the manifest
  a channel points at; `bun run e2e` reads the same claim off the RENDERED PAGE,
  which is the one place "list moved and the frame did not" is a fact about the
  application rather than about a JSON file.

  Background:
    Given build "one" is published and promoted to the qa channel

  @live
  Scenario: Deploying a sub-app leaves the frame where it was
    A promote MERGES into the composition the channel already serves rather than
    replacing it. With one unit the two write identical bytes, which is why this
    had nothing to hold it on the previous slate.

    Given a new "list" unit is published
    When the operator promotes that "list" unit to the qa channel
    Then visitors to the qa origin receive the new "list" unit within the propagation window
    And the qa channel still serves build "one" for the shell

  @live
  Scenario: Deploying the frame leaves the sub-app at its new version
    Given a new "list" unit is published
    And that "list" unit is already deployed to the qa channel
    And a new "shell" unit is published
    When the operator promotes that "shell" unit to the qa channel
    Then visitors to the qa origin receive the new "shell" unit within the propagation window
    And the qa channel still serves the new "list" unit

  @live
  Scenario: Rolling one unit back leaves the other at its newer version
    The claim a rollback is worth having for: what shipped in between stays
    shipped. The frame was deployed after the sub-app and is not dragged back
    with it.

    Given a new "list" unit is published
    And that "list" unit is already deployed to the qa channel
    And a new "shell" unit is published
    And that "shell" unit is already deployed to the qa channel
    When the operator promotes build "one"'s "list" unit to the qa channel
    Then visitors to the qa origin receive build "one"'s "list" unit within the propagation window
    And the qa channel still serves the new "shell" unit

  @live
  Scenario: Each unit's files are served from that unit's own directory
    Given a new "list" unit is published
    When the operator promotes that "list" unit to the qa channel
    Then each sub-app on the qa origin is fetched from its own unit's directory

  @live
  Scenario: Publishing after a change to one unit uploads that unit alone
    When the operator builds and publishes with only "list" changed
    Then only the list unit is uploaded

  @live
  Scenario: A composition with no contract in common is refused
    Given a unit published against a contract the shell does not support
    When the operator promotes that unit to the qa channel
    Then the promotion is refused because no contract is shared
    And the qa channel still serves build "one" for every unit

  @live
  Scenario: A sub-app needing a member the shell does not have is refused
    Given a unit published needing a member the shell does not provide
    When the operator promotes that unit to the qa channel
    Then the promotion is refused and names the member and the sub-app
    And the qa channel still serves build "one" for every unit

  @live
  Scenario: Promoting an unpublished unit is refused
    When the operator promotes a "shell" unit that was never published
    Then the promotion is refused because that unit is not published
    And the qa channel still serves build "one" for every unit
