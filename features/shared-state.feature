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
  #
  # The two rules below look almost the same and check different things. Which
  # composition a scenario reads is the whole difference, and it is not visible
  # in the scenario text, which is why it is a Rule and not a tag nobody reads.

  Rule: The composition the channel serves

    # @browser without @test-channel loads the LIVE address, so these read what
    # is deployed. That is a check on the deploy and worth having: five bundles
    # published at different times, composed by a pointer, agreeing in a real
    # browser.
    #
    # It is not a check on this working tree. An edit here reaches none of these
    # scenarios until it is published and promoted.

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

  Rule: The composition this working tree builds

    # The gap section 19 was opened for. Every scenario above reads the DEPLOYED
    # bundles, so a change to `createStore` was caught only after it had been
    # published and promoted - which was found by reading those scenarios as
    # proof of a change that was not deployed yet. They passed, against the old
    # build.
    #
    # These two are copies, not moves. Trading a deploy check for a code check
    # would lose the thing the rule above is good at. The Background builds and
    # promotes from this tree, the same way the boundary and integrity scenarios
    # do, so the browser loads the bundles this edit produced.

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

    # The requirement is that a sub-app is fetched from the store as its own
    # file, and that it is not RUN until its view needs it. Those were one
    # scenario while the only way to have the file was to import it.
    #
    # Preloading separates them (section 17). The bundles for a view nobody has
    # opened are now warmed in the background, so "not fetched yet" stopped
    # being true while "not evaluated yet" stayed true - and it is the second
    # one that a sub-app can notice, because it decides when its top-level code
    # runs.
    #
    # There is no scenario here for "the import does not fetch a second time",
    # and the reason is measured: with the preload tags removed the count after
    # the navigation is 1 as well, so such a scenario would be green whether or
    # not the page preloaded anything. `bun run measure:preload` asks that
    # question the only way it can be asked - with a control beside it.

    # @test-channel, and not because these need a channel of their own. The
    # preload tags are written by the SERVER, and a @browser scenario without
    # this tag reads the deployed image - so an edit to `html.ts` would not
    # reach the page under test and the scenarios could not be falsified from
    # here. @test-channel runs `bun src/server/index.ts` out of this tree.

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
