Feature: Serving through a store outage
  As a visitor
  I want the application to keep loading when the store is unreachable
  So that a store outage degrades the deploy system, not the application

  Background:
    Given the qa channel points at build "alpha"

  @local
  Scenario: A running server keeps serving the last build it read
    Given a visitor has already loaded the qa origin
    When the store becomes unreachable
    Then visitors to the qa origin continue to receive build "alpha"

  @local
  Scenario: An origin that could not refresh its manifest says so
    Given a visitor has already loaded the qa origin
    When the store becomes unreachable
    And the server's copy of the manifest is older than its refresh interval
    And a visitor loads the qa origin
    And a visitor loads the qa origin
    Then the shell reports the manifest it was rendered from as older than the refresh interval
    And the shell names what its last refresh failed with

  @local
  Scenario: A visitor is never made to wait for the store
    Given a visitor has already loaded the qa origin
    And the server's copy of the manifest is older than its refresh interval
    And the store has become slow to answer
    When a visitor loads the qa origin
    Then the shell is returned without waiting for the store

  @local
  Scenario Outline: A manifest the server cannot trust does not replace a good one
    Given a visitor has already loaded the qa origin
    When the qa channel's manifest is replaced with <kind>
    Then visitors to the qa origin continue to receive build "alpha"

    Examples:
      | kind                                  |
      | "a truncated document"                |
      | "valid JSON that is not a manifest"   |

  @local
  Scenario: A server that has never read a manifest reports itself unavailable
    Given a server that has not yet read any manifest
    And the store is unreachable
    When a visitor loads the qa origin
    Then the request is refused as temporarily unavailable
    And no shell is returned

  @local
  Scenario: The health check answers while the store is unreachable
    Given the store is unreachable
    When the platform checks the server's health
    Then the server reports itself healthy
