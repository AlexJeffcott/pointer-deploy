Feature: Recovering from an error in one panel
  As a visitor
  I want a panel failing to cost me that panel and nothing else
  So that a fault in a bundle published weeks ago does not take the page with it

  The two scenarios about a panel are missing, and they are not gaps. Both drove
  a sub-app into its own error boundary and read what happened to the frame
  around it, and `PLAN.md` step 0 leaves no sub-app to throw. The boundary
  itself is still in `src/web/shell/AsyncAppLoader.tsx`, unexercised until step 1
  mounts something inside it; TODO §31 records that, and `scripts/falsify.ts`
  lost the two mutations that used to hold it.

  What remains is the other boundary, which is the frame's own and needs nothing
  inside it.

  Background:
    Given the qa channel points at build "boundary"

  @browser @test-channel
  Scenario: The frame throwing replaces the page and offers a reload
    When a visitor opens the frame
    And the frame is asked to throw
    Then the page reports that the frame failed
    And the page offers to reload
