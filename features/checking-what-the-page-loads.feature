Feature: Checking every file the page loads against the manifest
  As a visitor
  I want the browser to refuse any file that is not the bytes that were published
  So that whoever can write a manifest cannot run their own code on this origin

  The digest is checked in two places and they are not the same check: the
  server writes it into the page, and the browser refuses a file that does not
  match. On this slate the files are the frame's own — its script, its
  stylesheet, and the shared chunks the import map names — because `PLAN.md`
  step 0 builds no sub-app. The Scenario Outline that corrupted a sub-app's
  digest and watched its panel be refused is gone with it, and comes back at
  step 1; TODO §31 records the loss.

  Background:
    Given the qa channel points at build "alpha"

  @live @local
  Scenario: A shell names the only origins its files may come from
    When a visitor loads the qa origin
    Then the shell permits scripts and stylesheets from the store alone
    And the shell permits no inline script but the import map it carries

  @live @local
  Scenario: A shell names the digest of every file it tells the browser to fetch
    When a visitor loads the qa origin
    Then the shell's own script and stylesheet carry the digests the manifest records
    And every module the import map names carries one too

  @browser @test-channel
  Scenario: The page assembles from its own bundles under its own policy
    Every mutation of the policy leaves a page that answers 200 and a server
    that reports the right build. Only a browser can tell the difference, and
    what it reports is whether it refused anything.

    When a visitor opens the frame
    Then the frame is styled by the stylesheet its own unit published
    And the browser refused nothing the page asked for
