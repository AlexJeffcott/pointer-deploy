Feature: Rolling a channel back onto a manifest from before the schema changed
  As an operator
  I want a channel still pointing at a schema 2 manifest to render in a browser
  So that rolling back that far is a working rollback rather than a blank page

  # Both channels a visitor can reach are schema 3, so no browser has ever
  # loaded a page assembled the schema 2 way. manifest.test.ts parses a schema 2
  # document in isolation, which proves the parser and not the page - and the
  # difference is exactly what "the rollback works" means. Schema 2 shares ONE
  # assetBase across every unit and resolves the import map against that one
  # base; whether five bundles fetched that way still make one application is
  # not a question a parser can answer.
  #
  # The manifest is kept, never rebuilt here: features/support/fixtures/schema-2.json
  # names a directory in the store that nothing deletes, written once by
  # `bun run fixture:schema-2`. A fixture rebuilt per run would be today's
  # bundles under yesterday's schema, which is not the operation being claimed.
  #
  # These are @test-channel, which runs the documented server entry point
  # locally against the real store. A test-* channel is reached by a Host
  # header and no browser can be made to send one, so this is the same
  # compromise scripts/e2e-independent-deploy.ts makes, for the same reason.
  # The store, the bundles, the pointer and the browser are all real; only the
  # process the HTML comes from is local. The pointer is put back afterwards.

  Background:
    Given the qa channel points at the kept schema 2 manifest
    And a visitor opens the counters view

  # Without this the pair below passes on a channel that never moved: schema 3
  # renders a working page too, and that is the page every other @browser
  # scenario is already looking at.
  @browser @test-channel
  Scenario: A page served from a schema 2 manifest comes from one build directory
    Then the page names one build and no composition
    And every file the page fetched from the store came from that one directory

  # The claim the fixture exists for. The import map is the only thing making
  # five separately fetched bundles share one signals runtime, and under
  # schema 2 it resolves against the single base rather than the shell's own.
  @browser @test-channel
  Scenario: Five bundles resolved through one import map are still one application
    When they raise the "alpha" counter by 6
    And they open the totals view
    Then every sub-app that lists counters reads "alpha" as 6
