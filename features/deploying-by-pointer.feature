Feature: Deploying by promoting a published build
  As an operator
  I want a deploy to be a change of which build a channel points at
  So that shipping the application needs no server image build and no rollout

  Background:
    Given build "alpha" is published
    And build "beta" is published
    And the qa channel points at build "alpha"

  @live
  Scenario: Visitors receive a newly promoted build
    When the operator promotes build "beta" to the qa channel
    Then visitors to the qa origin receive build "beta" within the propagation window

  @live
  Scenario: A deploy leaves the running server untouched
    When the operator promotes build "beta" to the qa channel
    Then the machines serving the qa origin are the instances that were already running

  @live
  Scenario: Visitors return to the previous build when it is promoted back
    Given the qa channel points at build "beta"
    When the operator promotes build "alpha" to the qa channel
    Then visitors to the qa origin receive build "alpha" within the propagation window

  @live
  Scenario: Promoting an unpublished build is refused
    When the operator promotes build "gamma" to the qa channel
    Then the promotion is refused because build "gamma" is not published
    And visitors to the qa origin continue to receive build "alpha"

  @live
  Scenario: Promoting one channel leaves every other channel untouched
    Given the prod channel points at build "alpha"
    When the operator promotes build "beta" to the qa channel
    Then visitors to the prod origin continue to receive build "alpha"
