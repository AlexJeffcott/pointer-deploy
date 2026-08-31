Feature: Refusing a build this working tree did not make
  As an operator
  I want promote to refuse a build whose source is not the source I am looking at
  So that a well-formed manifest cannot quietly put an older commit, or work no
  commit holds at all, in front of visitors

  @local
  Scenario: A build from an older commit is refused on a real channel
    Given a build made from an older commit
    When the operator promotes it to the "qa" channel
    Then the promotion is refused because the build is not from this tree's source
    And the store was never contacted

  @local
  Scenario: A build from an uncommitted working tree is refused on a real channel
    Given a build made from an uncommitted working tree
    When the operator promotes it to the "qa" channel
    Then the promotion is refused because the build is not from this tree's source
    And the store was never contacted

  @local
  Scenario: A build from the commit this tree is at is promoted
    Given a build made from the commit this tree is at
    When the operator promotes it to the "qa" channel
    Then the promotion is not refused for its source
    And the store was contacted

  @local
  Scenario: The suite's own channels still accept a build from an older commit
    Given a build made from an older commit
    When the operator promotes it to the "test-qa" channel
    Then the promotion is not refused for its source
    And the store was contacted

  @local
  Scenario: An older build is promoted when the operator overrides the check
    Given a build made from an older commit
    When the operator promotes it to the "qa" channel with --no-source-check
    Then the promotion is not refused for its source
    And the promotion warns that the source check was skipped
    And the store was contacted
