Feature: Asking an origin for a build it does not serve
  As an operator
  I want to run an older unit on a channel without promoting it
  So that I can see what a rollback would serve before I make everyone see it

  The unit named throughout is `list`. It was the shell on `PLAN.md` step 0's
  slate, because the shell was the only unit there was, and an override of the
  only unit cannot show that the REST of the composition stays where it is.

  Background:
    Given build "one" is published and promoted to the qa channel
    And a new "list" unit is published
    And that "list" unit is already deployed to the qa channel

  @live @test-channel
  Scenario: Asking for an older unit serves it and moves no channel
    When a visitor asks the qa origin for build "one"'s "list" unit
    Then the page runs build "one"'s "list" unit
    And the page still runs the shell the channel serves
    And the qa channel still serves the new "list" unit

  @live @test-channel
  Scenario: A build that was published and never promoted can be asked for
    Given an unpublished "list" unit is published
    When a visitor asks the qa origin for that "list" unit
    Then the page runs that "list" unit

  @live @test-channel
  Scenario: An id the channel has never served is refused
    When a visitor asks the qa origin for a "list" unit it has never served
    Then the request is refused as a bad request

  @live @test-channel
  Scenario: A unit that cannot be composed with the rest is refused
    Given a unit published against a contract the shell does not support
    And that unit is recorded in the qa channel's history
    When a visitor asks the qa origin for that unit
    Then the request is refused because no contract is shared

  @live @test-channel
  Scenario: A shell this server cannot feed is refused
    Given a shell recorded in the qa channel's history that reads a block field this server does not write
    When a visitor asks the qa origin for that shell
    Then the request is refused because this server cannot feed that shell

  @live @test-channel
  Scenario: The first visitor to a machine that has just started can still ask
    An override is judged against two documents the request path only `peek`s,
    so a process that has read neither refuses every id it is asked for. Both
    are read once at boot for that reason. Every other scenario here has already
    made a request before it asserts anything, so this is the only one that can
    see the difference.

    Given the server has just started and answered nobody
    When a visitor asks the qa origin for build "one"'s "list" unit
    Then the page runs build "one"'s "list" unit

  @live @test-channel
  Scenario: An operator's own choice is not counted as a visitor's
    When a visitor asks the qa origin for build "one"'s "list" unit
    And the qa origin is asked what it has served
    Then that composition is counted as an operator's override, and nothing else is
