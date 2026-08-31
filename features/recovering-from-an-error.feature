Feature: Recovering from an error in one panel
  As a visitor
  I want one panel failing to cost me that panel and nothing else
  So that a fault in a bundle published weeks ago does not take the page with it

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

  @browser @test-channel
  Scenario: The frame throwing replaces the page and offers a reload
    When the frame is asked to throw
    Then the page reports that the frame failed
    And the page offers to reload
