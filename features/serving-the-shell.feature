Feature: Serving the application shell from the live manifest
  As a visitor
  I want the page to load the build the channel currently points at
  So that I see the version that is live now, not one frozen into the server image

  Background:
    Given the qa channel points at build "alpha"

  @live
  Scenario: A visitor receives the build the channel points at
    When a visitor loads the qa origin
    Then the shell identifies build "alpha"
    And the shell loads the script and the stylesheet of build "alpha"

  @live @local
  Scenario: A shell is never stored by an intermediary
    When a visitor loads the qa origin
    Then no cache between the server and the visitor is permitted to store the shell

  # The negative complement of the first scenario. Without it, a server that
  # quietly kept a copy of dist/ would pass, and the claim is that it has none.
  @live @local
  Scenario: The server holds no application files of its own
    When a visitor requests an application asset path from the qa origin
    Then the request is refused as not found

  @live
  Scenario: A visitor arriving at a suspended server receives the current build
    Given no machine is running
    When a visitor loads the qa origin
    Then the shell identifies build "alpha"
