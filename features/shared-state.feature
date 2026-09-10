Feature: Sharing state between the frame and a sub-app deployed apart from it
  As a visitor
  I want the frame and the panel inside it to agree about what the page says
  So that the page behaves as one application even though it is assembled from
  bundles that were built and published separately

  Rule: The composition the channel serves

    Background:
      Given a visitor opens the hello view

    @browser
    Scenario: The panel draws what the service holds, through the frame
      The panel never calls the service. The frame reads it once and hands the
      reading down, so what is on screen and what the service holds are the
      same fact rather than two calls that could disagree.

      Then the panel greets what the service holds

    @browser
    Scenario: What the panel writes reaches the frame's store and comes back
      The panel holds no state. It writes into a signal the SHELL's bundle
      created, and redraws because both bundles share one runtime. A panel
      carrying its own Preact would write the value and never redraw.

      When they set the audience to "Bologna"
      Then the panel greets "Bologna"

    @browser
    Scenario: The value survives the panel being unmounted, because the frame owns it
      When they set the audience to "Bologna"
      And they open the service view
      And they open the hello view
      Then the panel greets "Bologna"

  Rule: The composition this working tree builds

    Background:
      Given the qa channel points at build "tree"
      And a visitor opens the hello view

    @browser @test-channel
    Scenario: What the panel writes comes back, from this tree
      When they set the audience to "Bologna"
      Then the panel greets "Bologna"
