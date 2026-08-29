Feature: Reading the page's values from a service on its own schedule
  As an operator
  I want the page to be told where the service is and whether it can use it
  So that a fourth deploy schedule is a thing I can read rather than guess at

  # §13. Every other party here is built from this repository at one commit, so
  # `tsc` is the oracle and the contract matrix is complete. The service is not:
  # it deploys when somebody deploys it, and its surface is not a TypeScript
  # file. What replaces the compiler is a shape checked at the boundary and a
  # version set compared at serve time.
  #
  # These are @local, and the weaker claim is written down rather than hidden:
  # the stub store carries no history, so the origin knows no shell's surface
  # and the gate here can only reach its undecidable state. The gate DECIDING is
  # proved live, by scripts/e2e-api-gate.ts, against the deployed service.

  Background:
    Given the qa channel points at build "alpha"

  @local
  Scenario: A server that names a service tells the page where it is
    Given a service that answers "v1"
    When a visitor loads the qa origin
    Then the shell names that service as the one to read

  # The state every scenario written before §13 runs in, and it has to keep
  # working: a page with no service configured is the page this repository
  # served for its whole life until now.
  @local
  Scenario: A server with no service configured tells the page nothing
    When a visitor loads the qa origin
    Then the shell names no service

  # The third state the header exists to separate, and the one a rollback
  # depends on: a shell that records no version cannot be judged, and is served.
  # Guessing here would take away every unit published before §13.
  @local
  Scenario: A shell that records no API version is not judged
    Given a service that answers "v1"
    When a visitor loads the qa origin
    Then the origin reports the API gate as "unread"
