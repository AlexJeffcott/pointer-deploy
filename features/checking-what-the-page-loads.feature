Feature: Checking every file the page loads against the manifest
  As a visitor
  I want the browser to refuse any file that is not the bytes that were published
  So that whoever can write a manifest cannot run their own code on this origin

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
    And every sub-app the shell can import carries one too

  @browser @test-channel
  Scenario Outline: A sub-app whose <file> does not match its digest does not run
    Given the digest recorded for the <file> of "alpha" is wrong
    When a visitor navigates to the counters view
    Then the "bravo" panel is on the page
    And the "alpha" panel is refused rather than rendered

    Examples:
      | file       |
      | script     |
      | stylesheet |

  @browser @test-channel
  Scenario: The page assembles from five bundles under its own policy
    When a visitor opens the counters view
    And they open the totals view
    Then every panel on the page is styled by its own stylesheet
    And the browser refused nothing the page asked for
