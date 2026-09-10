Feature: Rolling a channel back onto a manifest from before the schema changed
  As an operator
  I want a channel still pointing at a schema 2 manifest to render in a browser
  So that rolling back that far is a working rollback rather than a blank page

  The page this serves is the OLD shell, out of the kept directory, so it draws
  the sub-app that build placed on its landing route. That is the point: a
  rollback this far has to render what it rendered then, not what this tree
  builds. The step below opens the view naming the units the FIXTURE names, so
  removing `hello` from the tree at `PLAN.md` step 0 leaves both scenarios
  measuring exactly what they measured before.

  Background:
    Given the qa channel points at the kept schema 2 manifest
    And a visitor opens the landing view of that manifest

  @browser @test-channel
  Scenario: A page served from a schema 2 manifest comes from one build directory
    Then the page names one build and no composition
    And every file the page fetched from the store came from that one directory

  @browser @test-channel
  Scenario: Bundles resolved through one import map are still one application
    When they set the audience to "Bologna"
    Then the panel greets "Bologna"
