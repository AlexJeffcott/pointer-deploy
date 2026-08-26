Feature: Sharing state between independently loaded sub-apps
  As a visitor
  I want every panel on the page to agree about my name, my colour and every count
  So that the page behaves as one application even though it is assembled from
  bundles that were built and published separately

  # Every scenario here runs in a real browser. Nothing below is observable to
  # curl: the counters live in one signals runtime shared by five bundles that
  # the browser fetches separately and resolves through an import map. If each
  # bundle carried its own Preact the page would still load, still pass every
  # other check, and silently stop agreeing with itself.

  Background:
    Given a visitor opens the counters view

  @browser
  Scenario: A count raised in one sub-app is read by a sub-app on another view
    When they raise the "alpha" counter by 6
    And they raise the "bravo" counter by 3
    And they open the totals view
    Then every sub-app that lists counters reads "alpha" as 6
    And every sub-app that lists counters reads "bravo" as 3

  @browser
  Scenario: A sub-app that created no counter still sees the ones that exist
    When they raise the "alpha" counter by 2
    And they open the totals view
    Then the totals view lists the namespaces alpha, bravo, charlie and delta

  # The counts were right while every bar was drawn full width, because the
  # fill was an inline element and width did nothing to it.
  @browser
  Scenario: A sub-app that draws a count shows a larger one as a longer bar
    When they raise the "alpha" counter by 4
    And they open the totals view
    Then the bar for "alpha" is longer than the bar for "charlie"

  @browser
  Scenario: The name the frame holds reaches every sub-app
    When they set the name to "Bologna"
    Then every sub-app on the page names "Bologna"

  @browser
  Scenario: The colour the frame holds reaches every sub-app
    When they set the colour to "#e2703a"
    Then every sub-app on the page is drawn in that colour

  # The requirement is that an app is fetched from the store, not shipped with
  # the shell. A scenario that only checked it eventually appears would pass on
  # a shell that had it bundled all along.
  @browser
  Scenario: A sub-app is fetched only when a view first needs it
    Then no bundle for the totals view has been fetched
    When they open the totals view
    Then the bundles for the totals view have been fetched

  @browser
  Scenario: Returning to a view does not fetch its bundles again
    When they open the totals view
    And they open the counters view
    And they open the totals view
    Then each bundle for the totals view was fetched once
