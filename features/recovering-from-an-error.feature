Feature: Recovering from an error in one panel
  As a visitor
  I want one panel failing to cost me that panel and nothing else
  So that a fault in a bundle published weeks ago does not take the page with it

  # Every scenario here runs in a real browser, and none of them could pass
  # before sub-apps became components. A sub-app that rendered into its own
  # Preact root threw past every boundary the shell could put around it: the
  # error reached window.onerror and the shell was never told. Measured, not
  # assumed - see the TODO, §7.
  #
  # The Background builds and promotes from this tree, for the reason the
  # integrity scenarios give: a @browser scenario reading a composition this
  # run did not build could not be falsified by an edit here, so it would prove
  # nothing about its own quality. The boundary lives in a CLIENT bundle, so
  # the bundle has to come from the working tree or a mutation changes nothing
  # the browser ever loads.

  Background:
    Given the qa channel points at build "boundary"
    And a visitor opens the counters view

  @browser @test-channel
  Scenario: A sub-app that throws costs one panel and no more
    When they raise the "bravo" counter by 2
    And the "alpha" panel is asked to throw
    Then the "alpha" panel reports an error
    And the "bravo" panel reads 2

  @browser @test-channel
  Scenario: A panel that threw can be mounted again
    When the "alpha" panel is asked to throw
    And they mount the "alpha" panel again
    Then the "alpha" panel is drawn

  # The frame has no smaller reload than the document: the code that would draw
  # a recovery control is the code that threw.
  @browser @test-channel
  Scenario: The frame throwing replaces the page and offers a reload
    When the frame is asked to throw
    Then the page reports that the frame failed
    And the page offers to reload
