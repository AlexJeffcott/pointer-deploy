Feature: Choosing which build the page runs
  As an operator
  I want to run an older unit on a channel without promoting it
  So that I can see what a rollback would serve before I make everyone see it

  Background:
    Given build "one" is published and promoted to the qa channel
    And a new "alpha" unit is published
    And that "alpha" unit is already deployed to the qa channel

  @live @test-channel
  Scenario: The page offers every unit the channel has served
    When a visitor loads the qa origin
    Then the page offers both "alpha" units
    And the option the channel serves is the one the page is showing

  @live @test-channel
  Scenario: Choosing an older unit serves it and moves no channel
    When a visitor asks the qa origin for build "one"'s "alpha" unit
    Then the page runs build "one"'s "alpha" unit
    And the page still runs the shell the channel serves
    And the qa channel still serves the new "alpha" unit

  @live @test-channel
  Scenario: The page offers a build that was published and never promoted
    Given an unpublished "bravo" unit is published
    When a visitor loads the qa origin
    Then the page offers that "bravo" unit

  @live @test-channel
  Scenario: An id the channel has never served is refused
    When a visitor asks the qa origin for an "alpha" unit it has never served
    Then the request is refused as a bad request

  @live @test-channel
  Scenario: A unit that cannot be composed with the rest is offered and disabled
    Given a unit published against a contract the shell does not support
    And that unit is recorded in the qa channel's history
    Then the qa origin offers that unit and will not let it be chosen

  @live @test-channel
  Scenario: A shell this server cannot feed is offered and disabled
    Given a shell recorded in the qa channel's history that reads a block field this server does not write
    Then the qa origin offers that shell and will not let it be chosen

  @live @test-channel
  Scenario: Choosing a shell this server cannot feed is refused
    Given a shell recorded in the qa channel's history that reads a block field this server does not write
    When a visitor asks the qa origin for that shell
    Then the request is refused because this server cannot feed that shell

  @browser @test-channel
  Scenario: An operator picks an older unit from the page
    When a visitor picks build "one"'s "alpha" unit from the switcher
    Then the page runs build "one"'s "alpha" unit
    And both sub-apps still render

  @live @test-channel
  Scenario: An operator's own choice is not counted as a visitor's
    When a visitor asks the qa origin for build "one"'s "alpha" unit
    And the qa origin is asked what it has served
    Then that composition is counted as an operator's override, and nothing else is
