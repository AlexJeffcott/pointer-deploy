Feature: Refusing a build the test harness made
  As an operator
  I want promote to refuse a build that carries a test marker
  So that running the suites and then deploying cannot ship a scenario's
  build to visitors

  @local
  Scenario: A build the harness made is refused on a real channel
    Given a build the test harness made
    When the operator promotes it to the "qa" channel
    Then the promotion is refused because the build came from the harness
    And the store was never contacted

  @local
  Scenario: The suite's own channels still accept a build the harness made
    Given a build the test harness made
    When the operator promotes it to the "test-qa" channel
    Then the promotion is not refused for carrying a marker
    And the store was contacted

  @local
  Scenario: An ordinary build is not refused on a real channel
    Given a build made the ordinary way
    When the operator promotes it to the "qa" channel
    Then the promotion is not refused for carrying a marker
    And the store was contacted
