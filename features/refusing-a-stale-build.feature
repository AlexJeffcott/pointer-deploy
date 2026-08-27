Feature: Refusing a build this working tree did not make
  As an operator
  I want promote to refuse a build whose source is not the source I am looking at
  So that a well-formed manifest cannot quietly put an older commit, or work no
  commit holds at all, in front of visitors

  # The other half of the guard next door. `dist/` outlives the tree that filled
  # it: build at one commit, do more work, and `promote <real channel>
  # --from-build` days later writes a manifest describing units nobody meant to
  # serve. It is exactly the harness-build accident, minus the marker that
  # catches that one - a build from an older commit carries no tell at all, and
  # every check downstream stays green because the manifest is well-formed.
  #
  # So a build records the source it came from, and promote compares it with the
  # tree before it will touch a real channel. Two readings refuse:
  #
  #   dirty     the bytes came from uncommitted work, so no commit holds the
  #             source of what visitors would run.
  #   mismatch  the bytes came from a different commit than this tree is at.
  #
  # The tree being dirty NOW is deliberately not one of them. A clean build at
  # HEAD is exactly commit HEAD however much has been edited since, and refusing
  # it would mean stashing to deploy a commit that is already reviewed.
  #
  # These are @local for the same reason the marker scenarios are: forcing the
  # failure means naming a real channel, so if the refusal were ever removed the
  # run itself would deploy to visitors.
  #
  # No stand-in is involved. The steps run the real scripts/promote.ts from a
  # temporary git repository holding nothing but a .gitignore and the
  # dist/build.json under test, with the store pointed at a host DNS cannot
  # resolve. So "reached the store" and "refused for its source" are both
  # positive readings, and removing the refusal swaps one for the other.

  @local
  Scenario: A build from an older commit is refused on a real channel
    Given a build made from an older commit
    When the operator promotes it to the "qa" channel
    Then the promotion is refused because the build is not from this tree's source
    And the store was never contacted

  # The reading the commit alone cannot give. Two dirty trees at one commit are
  # not the same source, so a dirty build is refused whatever the commit says -
  # otherwise the units a visitor runs come from work that is nowhere in git.
  @local
  Scenario: A build from an uncommitted working tree is refused on a real channel
    Given a build made from an uncommitted working tree
    When the operator promotes it to the "qa" channel
    Then the promotion is refused because the build is not from this tree's source
    And the store was never contacted

  # Without this the guard could refuse everything, which would pass both
  # scenarios above and stop anyone deploying at all.
  @local
  Scenario: A build from the commit this tree is at is promoted
    Given a build made from the commit this tree is at
    When the operator promotes it to the "qa" channel
    Then the promotion is not refused for its source
    And the store was contacted

  # And without this it could be a blanket refusal, and the suites - which
  # promote whatever dist/ holds, from whatever tree a developer is mid-edit in -
  # would stop working for a reason nothing here would explain.
  @local
  Scenario: The suite's own channels still accept a build from an older commit
    Given a build made from an older commit
    When the operator promotes it to the "test-qa" channel
    Then the promotion is not refused for its source
    And the store was contacted

  # Deliberately serving an older build is a real operation, so the refusal has
  # an override. It says what it let through: an override that went quiet would
  # be the same accident with one more step in front of it.
  @local
  Scenario: An older build is promoted when the operator overrides the check
    Given a build made from an older commit
    When the operator promotes it to the "qa" channel with --no-source-check
    Then the promotion is not refused for its source
    And the promotion warns that the source check was skipped
    And the store was contacted
