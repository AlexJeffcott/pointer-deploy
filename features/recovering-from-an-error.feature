Feature: Recovering from an error in one panel
  As a visitor
  I want a panel failing to cost me that panel and nothing else
  So that a fault in a bundle published weeks ago does not take the page with it

  Background:
    Given the qa channel points at build "boundary"
    And a visitor opens the hello view

  @browser @test-channel
  Scenario: A sub-app that throws costs its panel and not the frame
    When the "hello" panel is asked to throw
    Then the "hello" panel reports an error
    And the frame is still drawn

  @browser @test-channel
  Scenario: A panel that threw can be mounted again
    When the "hello" panel is asked to throw
    And they mount the "hello" panel again
    Then the "hello" panel is drawn

  @browser @test-channel
  Scenario: The frame throwing replaces the page and offers a reload
    When the frame is asked to throw
    Then the page reports that the frame failed
    And the page offers to reload
