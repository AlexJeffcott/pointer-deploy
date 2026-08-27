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

  # Keeping the last good build is the right behaviour and it is indistinguishable
  # from a healthy origin, which is the problem: a channel that has moved and an
  # origin that can no longer read the store look the same from outside. The age
  # stops growing only when a refresh works, so an origin that is stuck says a
  # bigger number every time it is asked.
  #
  # Two visits, because rule 2 is that a visitor never waits for the store: the
  # first request after the interval is answered from the copy the server
  # already had and STARTS the refresh, so what that refresh failed with is on
  # the next response and not on this one.
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
