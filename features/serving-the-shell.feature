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

  # A pointer deploy's one invisible failure: the channel moved and this origin
  # is still serving the composition before it. The page looks correct and every
  # check is green, so "the deploy has not arrived yet" and "this origin stopped
  # reading the store" used to be the same reading. @live too, because what the
  # deployed image says is the reading an operator actually gets.
  @live @local
  Scenario: A shell says how old the manifest it was rendered from is
    When a visitor loads the qa origin
    Then the shell reports the age of the manifest it was rendered from
    And the shell reports that its last refresh worked

  # @live, so it asserts against the DEPLOYED image rather than against a server
  # started here. Every other switcher scenario runs the entry point locally,
  # which proves the code and not the deploy; a switcher the running image does
  # not serve is a switcher nobody has.
  @live
  Scenario: The deployed origin offers the builds the channel has served
    When a visitor loads the qa origin
    Then the page offers a version switcher for every unit

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
