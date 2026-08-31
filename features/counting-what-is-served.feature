Feature: Counting which compositions the origin has handed out
  As an operator deciding whether an old unit can be removed
  I want the origin to say which compositions it has served
  So that a sunset is read off the traffic rather than guessed at

  Background:
    Given the qa channel points at build "alpha"

  @local
  Scenario: The origin counts the composition it handed out
    When a visitor loads the qa origin
    And the qa origin is asked what it has served
    Then it names the composition of build "alpha" on the qa channel
    And it has handed that composition out 1 time
    And none of those responses came from the version switcher

  @local
  Scenario: Two visitors of one composition are one row, not two
    Given a visitor has already loaded the qa origin
    When a visitor loads the qa origin
    And the qa origin is asked what it has served
    Then it names the composition of build "alpha" on the qa channel
    And it has handed that composition out 2 times

  @local
  Scenario: A composition served before a promote is still named after it
    Given a visitor has already loaded the qa origin
    When the qa channel points at build "beta"
    And visitors to the qa origin receive build "beta" within the propagation window
    And the qa origin is asked what it has served
    Then it names the composition of build "beta" on the qa channel
    And it names the composition of build "alpha" on the qa channel

  @local
  Scenario: A request that was refused is not counted as a composition
    When a visitor requests an application asset path from the qa origin
    And the qa origin is asked what it has served
    Then it names no composition at all

  @local
  Scenario: The reading says which population it cannot see
    When a visitor loads the qa origin
    And the qa origin is asked what it has served
    Then it says it cannot see a tab that keeps the composition it was opened on
    And it says the count starts again when the machine is replaced

  @live
  Scenario: The deployed origin says what it has handed out
    When a visitor loads the qa origin
    And the qa origin is asked what it has served
    Then it names the composition of build "alpha" on the qa channel
