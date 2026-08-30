Feature: Counting which compositions the origin has handed out
  As an operator deciding whether an old unit can be removed
  I want the origin to say which compositions it has served
  So that a sunset is read off the traffic rather than guessed at

  # The free half of §12, and the only half that is free. Every shell response
  # already names the units it was assembled from, and the shell is no-store, so
  # every navigation reaches the origin and the composition is decided there.
  #
  # The other half - which compositions are still RUNNING, in tabs opened before
  # a promote and never asked again - needs a route that accepts a write and a
  # bucket write key on the production origin. The reading says that about
  # itself rather than leaving a reader to assume it.

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

  # What a sunset is actually read off. The channel has moved and the old
  # composition is still named, which is the whole reason to count at all: a
  # reading that forgot it would say nothing was ever served it.
  @local
  Scenario: A composition served before a promote is still named after it
    Given a visitor has already loaded the qa origin
    When the qa channel points at build "beta"
    And visitors to the qa origin receive build "beta" within the propagation window
    And the qa origin is asked what it has served
    Then it names the composition of build "beta" on the qa channel
    And it names the composition of build "alpha" on the qa channel

  # Only a shell that was actually handed out. A refusal is not a composition
  # anybody is running, and counting one would put a row in front of an operator
  # that no page anywhere corresponds to.
  @local
  Scenario: A request that was refused is not counted as a composition
    When a visitor requests an application asset path from the qa origin
    And the qa origin is asked what it has served
    Then it names no composition at all

  # The limits travel in the document. A count of what was handed out, read as a
  # count of what is still running, is how a unit gets removed out from under
  # the tabs still using it.
  @local
  Scenario: The reading says which population it cannot see
    When a visitor loads the qa origin
    And the qa origin is asked what it has served
    Then it says it cannot see a tab that keeps the composition it was opened on
    And it says the count starts again when the machine is replaced

  # @live, so it asserts against the DEPLOYED image rather than a server started
  # here. Every scenario above runs the entry point locally, which proves the
  # code and not the deploy - and a reading the running image does not serve is
  # a reading nobody has.
  #
  # No count is asserted. This origin answers visitors as well as this suite, so
  # an exact number is one another request can break.
  @live
  Scenario: The deployed origin says what it has handed out
    When a visitor loads the qa origin
    And the qa origin is asked what it has served
    Then it names the composition of build "alpha" on the qa channel
