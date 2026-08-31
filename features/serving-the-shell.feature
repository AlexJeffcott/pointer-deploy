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

  @live @local
  Scenario: A shell says how old the manifest it was rendered from is
    When a visitor loads the qa origin
    Then the shell reports the age of the manifest it was rendered from
    And the shell reports that its last refresh worked

  @live
  Scenario: The deployed origin offers the builds the channel has served
    When a visitor loads the qa origin
    Then the page offers a version switcher for every unit

  @live @local
  Scenario: The server holds no application files of its own
    When a visitor requests an application asset path from the qa origin
    Then the request is refused as not found

  @live
  Scenario: A visitor arriving at a suspended server receives the current build
    Given no machine is running
    When a visitor loads the qa origin
    Then the shell identifies build "alpha"
