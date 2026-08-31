Feature: Rolling a channel back onto a manifest from before the schema changed
  As an operator
  I want a channel still pointing at a schema 2 manifest to render in a browser
  So that rolling back that far is a working rollback rather than a blank page

  Background:
    Given the qa channel points at the kept schema 2 manifest
    And a visitor opens the counters view

  @browser @test-channel
  Scenario: A page served from a schema 2 manifest comes from one build directory
    Then the page names one build and no composition
    And every file the page fetched from the store came from that one directory

  @browser @test-channel
  Scenario: Five bundles resolved through one import map are still one application
    When they raise the "alpha" counter by 6
    And they open the totals view
    Then every sub-app that lists counters reads "alpha" as 6
