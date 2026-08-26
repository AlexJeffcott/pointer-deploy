Feature: Serving through a store outage
  As a visitor
  I want the application to keep loading when the store is unreachable
  So that a store outage degrades the deploy system, not the application

  # Every scenario here is @local. Forcing a real outage, a corrupt manifest, or
  # a read count against the live bucket would mean deliberately breaking the
  # infrastructure the other features run on. The stub store is the honest way
  # to reach them, and the weaker claim is recorded rather than hidden.

  Background:
    Given the qa channel points at build "alpha"

  @local
  Scenario: A running server keeps serving the last build it read
    Given a visitor has already loaded the qa origin
    When the store becomes unreachable
    Then visitors to the qa origin continue to receive build "alpha"

  @local
  Scenario: A visitor is never made to wait for the store
    Given a visitor has already loaded the qa origin
    And the server's copy of the manifest is older than its refresh interval
    And the store has become slow to answer
    When a visitor loads the qa origin
    Then the shell is returned without waiting for the store

  # The store is slow here on purpose. Protecting a store that answers
  # instantly proves nothing: the reads would not overlap in the first place.
  @local
  Scenario: A burst of visitors causes one read of the manifest
    Given a visitor has already loaded the qa origin
    And the server's copy of the manifest is older than its refresh interval
    And the store has become slow to answer
    When many visitors load the qa origin at the same time
    Then the store is read once

  # Two different failures. A truncated document is rejected when it is parsed;
  # a well-formed document missing a field is rejected only because the server
  # validates what it parsed. Without the second row, dropping validation costs
  # nothing and a visitor gets a shell with no script tag.
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

  # If health depended on the manifest, a store outage would make the platform
  # kill machines that were serving visitors correctly.
  @local
  Scenario: The health check answers while the store is unreachable
    Given the store is unreachable
    When the platform checks the server's health
    Then the server reports itself healthy
