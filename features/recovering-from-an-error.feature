Feature: Recovering from an error in one panel
  As a visitor
  I want a panel failing to cost me that panel and nothing else
  So that a fault in a bundle published weeks ago does not take the page with it

  Two boundaries, and they are not the same boundary. `AsyncAppLoader.tsx` wraps
  each panel, so a sub-app that throws costs its own slot; `index.tsx` wraps the
  frame, so a frame that throws costs the page. `PLAN.md` step 0 left the first
  one with nothing mounted inside it. Step 1 mounts `list`.

  Background:
    Given the qa channel points at build "boundary"
    And a visitor opens the tasks view

  @browser @test-channel
  Scenario: A sub-app that throws costs its panel and not the frame
    When the "list" panel is asked to throw
    Then the "list" panel reports an error
    And the frame is still drawn

  @browser @test-channel
  Scenario: A panel that threw can be mounted again
    When the "list" panel is asked to throw
    And they mount the "list" panel again
    Then the "list" panel is drawn

  @browser @test-channel
  Scenario: The frame throwing replaces the page and offers a reload
    When the frame is asked to throw
    Then the page reports that the frame failed
    And the page offers to reload
