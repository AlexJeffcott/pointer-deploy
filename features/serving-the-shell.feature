Feature: Serving the application shell from the live manifest
  As a visitor
  I want the page to load the build the channel currently points at
  So that I see the version that is live now, not one frozen into the server image

  Rule: The build the channel points at

    Background:
      Given the qa channel points at build "alpha"

    @live
    Scenario: A visitor receives the build the channel points at
      When a visitor loads the qa origin
      Then the shell identifies build "alpha"
      And the shell loads the script and the stylesheet of build "alpha"

    @live @local
    Scenario: A shell is never stored by an intermediary
      When a visitor loads the qa origin
      Then no cache between the server and the visitor is permitted to store the shell

    @live @local
    Scenario: A shell says how old the manifest it was rendered from is
      When a visitor loads the qa origin
      Then the shell reports the age of the manifest it was rendered from
      And the shell reports that its last refresh worked

    @live @local
    Scenario: The server holds no application files of its own
      When a visitor requests an application asset path from the qa origin
      Then the request is refused as not found

    @live
    Scenario: A visitor arriving at a suspended server receives the current build
      Given no machine is running
      When a visitor loads the qa origin
      Then the shell identifies build "alpha"

  Rule: A view that names no unit

    The shell owns placement, and a view may place nothing. Such a view is not a
    hole in the page: the frame draws it, and the browser is told to fetch
    nothing for it. `PLAN.md` step 1 places `list` on `/` and step 4 places
    `board` on `/board`, so the subject of this rule is now the three routes
    that still name no unit - `/week`, waiting for a unit at step 5, and
    `/service` and `/backup`, which never get one.

    The page is one document for all five routes, so what it may name is exactly
    the units its views place: `list`, `board` and `week`, and nothing else.
    That is the half read off the HTML. The half about a particular view is read
    in a browser, below.

    What the page WARMS is the same list read a second way, and it moved to
    `warming-a-unit-before-its-view.feature` at step 4 - which is the step that
    gave warming a subject of its own.

    Background:
      Given the qa channel points at build "alpha"

    @live @local
    Scenario: The page names the units its views place, and no others
      When a visitor loads the qa origin
      Then the page names "list, board, week" for the browser to import, and no other sub-app

  Rule: The frame drawing those views, in a browser

    A view that names no unit has to cost the browser nothing. A count taken
    after the landing view has loaded and before one link is clicked is what
    says so: a link that navigated instead of routing would fetch the frame
    again and read as a page that works, and a view that quietly gained a unit
    would fetch a bundle.

    `PLAN.md` step 4 put a unit on `/board`, so the walk now opens a view that
    DOES name one - and the count is still zero, because the shell warmed that
    unit's files with the page. Measured on 2026-09-11 against the deployed
    origin: 0 requests across the walk. So this scenario carries a second claim
    from step 4 onwards, and `warming-a-unit-before-its-view.feature` is where
    that one is read off the mechanism rather than off a count.

    Background:
      Given the qa channel points at build "tree"

    @browser @test-channel
    Scenario: Moving between views draws each one and fetches nothing
      When a visitor opens the frame
      And they open every other view in the sidenav
      Then the frame drew each view under its own title
      And the browser fetched nothing while they walked
