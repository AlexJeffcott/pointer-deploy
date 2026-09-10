Feature: Previewing a build a pull request made
  As a reviewer
  I want a URL that runs the units a pull request built
  So that I can look at the change without it being deployed to anybody

  A pull request's build is published and promoted nowhere, so the only record
  of it is the unit catalogue. What a channel will take from that catalogue is
  decided by the unit's marker, §30. CI sets `BUILD_MARKER=pr-<number>`, and
  that marker is the one thing a real channel admits that it has never served.

  Background:
    Given the qa channel points at build "alpha"
    And the qa channel has served an earlier build

  @local
  Scenario: A build a pull request made can be asked for on qa
    Given a build marked "pr-42" is published and promoted nowhere
    When a visitor asks the qa origin for that build's "hello" unit
    Then the page runs that build's "hello" unit
    And the qa channel still points where it did

  @local
  Scenario: A build nobody marked can be asked for on qa
    Given an unmarked build is published and promoted nowhere
    When a visitor asks the qa origin for that build's "hello" unit
    Then the page runs that build's "hello" unit

  @local
  Scenario Outline: A marker qa does not admit is refused
    The rule is one marker at a time and not "anything marked". A harness build
    is what it was written for; the rest are the near misses that would let one
    through if the pattern were loose.

    Given a build marked "<marker>" is published and promoted nowhere
    When a visitor asks the qa origin for that build's "hello" unit
    Then the request is refused as a bad request

    Examples:
      | marker |
      | e2e    |
      | pr     |
      | pr-    |
      | pr-x   |
      | PR-42  |

  @local
  Scenario: A marker with something in front of a pull request's is refused
    The two anchors are asserted apart, because a mutation that drops one is
    caught by one of these and not the other. Every example above stays green
    under either.

    Given a build marked "xpr-42" is published and promoted nowhere
    When a visitor asks the qa origin for that build's "hello" unit
    Then the request is refused as a bad request

  @local
  Scenario: A marker with something after a pull request's is refused
    Given a build marked "pr-42x" is published and promoted nowhere
    When a visitor asks the qa origin for that build's "hello" unit
    Then the request is refused as a bad request

  @local
  Scenario: prod takes no marker at all, a pull request's included
    Given the prod channel points at build "alpha"
    And the prod channel has served an earlier build
    And a build marked "pr-42" is published and promoted nowhere
    When a visitor asks the prod origin for that build's "hello" unit
    Then the request is refused as a bad request

  @local
  Scenario: prod still takes a build nobody marked
    Given the prod channel points at build "alpha"
    And the prod channel has served an earlier build
    And an unmarked build is published and promoted nowhere
    When a visitor asks the prod origin for that build's "hello" unit
    Then the page runs that build's "hello" unit
