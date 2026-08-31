Feature: Sharing state between independently loaded sub-apps
  As a visitor
  I want every panel on the page to agree about my name, my colour and every count
  So that the page behaves as one application even though it is assembled from
  bundles that were built and published separately

  Rule: The composition the channel serves

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

  Rule: The composition this working tree builds

    Background:
      Given the qa channel points at build "tree"
      And a visitor opens the counters view

    @browser @test-channel
    Scenario: A count raised in one sub-app is read by another, from this tree
      When they raise the "alpha" counter by 6
      And they open the totals view
      Then every sub-app that lists counters reads "alpha" as 6

    @browser @test-channel
    Scenario: The name the frame holds reaches every sub-app, from this tree
      When they set the name to "Bologna"
      Then every sub-app on the page names "Bologna"

  Rule: Fetching a sub-app's files

    Background:
      Given the qa channel points at build "tree"
      And a visitor opens the counters view

    @browser @test-channel
    Scenario: The bundles for a view nobody has opened are warmed, not run
      Then the bundles for the totals view have been fetched
      And no sub-app on the totals view has run

    @browser @test-channel
    Scenario: Returning to a view does not fetch its bundles again
      When they open the totals view
      And they open the counters view
      And they open the totals view
      Then each bundle for the totals view was fetched once
