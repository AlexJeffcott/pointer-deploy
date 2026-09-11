Feature: Checking every file the page loads against the manifest
  As a visitor
  I want the browser to refuse any file that is not the bytes that were published
  So that whoever can write a manifest cannot run their own code on this origin

  The digest is checked in two places and they are not the same check: the
  server writes it into the page, and the browser refuses a file that does not
  match. `PLAN.md` step 1 builds `list`, so both halves cover a separately
  published sub-app again as well as the frame's own files and the shared chunks
  the import map names.

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
    And every sub-app the shell can import carries one too

  @browser @test-channel
  Scenario Outline: A sub-app whose <file> does not match its digest does not run
    Given the digest recorded for the <file> of "list" is wrong
    When a visitor navigates to the tasks view
    Then the "list" panel is refused rather than rendered
    And the frame is still drawn

    Examples:
      | file       |
      | script     |
      | stylesheet |

  @browser @test-channel
  Scenario: The page assembles from its own bundles under its own policy
    Every mutation of the policy leaves a page that answers 200 and a server
    that reports the right build. Only a browser can tell the difference, and
    what it reports is whether it refused anything.

    When a visitor opens the frame
    Then the frame is styled by the stylesheet its own unit published
    And every panel on the page is styled by its own stylesheet
    And the browser refused nothing the page asked for
