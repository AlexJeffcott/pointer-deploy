Feature: Checking every file the page loads against the manifest
  As a visitor
  I want the browser to refuse any file that is not the bytes that were published
  So that whoever can write a manifest cannot run their own code on this origin

  # The hole this closes is the one the README names: whoever can write
  # manifests/eu/prod.json can point the page at any file on the store, and the
  # page would load it. Two mechanisms, and neither is sufficient alone:
  #
  #   a digest   the manifest names the bytes it expects for each file, and the
  #              browser refuses the file when they differ.
  #   a policy   nothing may be fetched from an origin the manifest does not
  #              name, and no inline script may run but the import map.
  #
  # The digest is the answer to a swapped file. The policy is the answer to a
  # manifest naming an origin of its author's choosing, which no digest can
  # catch because whoever wrote the manifest wrote the digest beside it.
  #
  # Both mechanisms come from the SERVER: the policy is a response header, the
  # digests are attributes it renders. So none of this is @live. An @live
  # scenario runs against the DEPLOYED image, which carries whatever server was
  # last shipped, and one written here would be red until someone deployed - a
  # red that reports the deploy queue rather than a defect. Add @live to the
  # first two once the image carries this.
  #
  # The browser scenarios are @test-channel instead, which runs the documented
  # entry point here against the real store, the same compromise the schema 2
  # scenarios make.

  Background:
    Given the qa channel points at build "alpha"

  @local
  Scenario: A shell names the only origins its files may come from
    When a visitor loads the qa origin
    Then the shell permits scripts and stylesheets from the store alone
    And the shell permits no inline script but the import map it carries

  @local
  Scenario: A shell names the digest of every file it tells the browser to fetch
    When a visitor loads the qa origin
    Then the shell's own script and stylesheet carry the digests the manifest records
    And every sub-app the shell can import carries one too

  # The claim the whole item exists for, and the only check that can make it:
  # whether a browser REFUSES a file is not observable to anything that reads
  # HTML. One digest in the pointer is replaced with a well-formed one that
  # matches nothing, which is what a swapped file looks like from the page.
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

  # The other half. A policy strict enough to be worth having is also strict
  # enough to break the page, and the page breaking is silent: the shell paints
  # its frame either way.
  @browser @test-channel
  Scenario: The page assembles from five bundles under its own policy
    When a visitor opens the counters view
    And they open the totals view
    Then every panel on the page is styled by its own stylesheet
    And the browser refused nothing the page asked for
