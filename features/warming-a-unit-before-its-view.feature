Feature: Warming a unit's files before its view is opened
  As a visitor who is about to open a view
  I want its bundle already in this browser
  So that the navigation draws the panel rather than waiting on the network

  `PLAN.md` step 4, and the first step at which this can be measured at all.
  The shell emits a `modulepreload` per sub-app script and a style preload per
  stylesheet on every load, from the composition it is SERVING rather than from
  the channel's manifest. Until step 4 every unit this repository built was on
  the route a visitor lands on, so the warm raced an import that was about to
  happen anyway and there was no reading to take. `board` is on `/board`, so
  there is.

  The page warms THREE units and not two. `list` is warmed as well, and its
  pair buys nothing because the landing route mounts it. Two of the three are
  off that route - `board` from step 4 and `week` from step 5 - so four of the
  six warmed files are the subject and two are not. Both off-screen units are
  read here, because one of them measured is a claim about one bundle.

  A hint, never a background `import()`. An import EVALUATES the module, so a
  unit the visitor never opens would have its top-level code run - and when that
  runs is a behaviour a sub-app can notice. A preload fills the HTTP cache and
  does nothing else.

  The reading is the browser's own resource timings and not a count of requests.
  A count is what a scenario was written against on the previous slate and
  deleted for: "the bundle was fetched once after the navigation" is true
  whether or not the page warmed it, because with no warm the import does the
  one fetch itself. What discriminates is WHEN the fetch happened and WHAT
  started it, and both are on the timing entry.

  The cost is stated rather than hidden: one modulepreload and one style preload
  per off-screen unit per load, for a visitor who may never navigate. What that
  buys in milliseconds is a question a scenario cannot answer, because it has no
  control to compare against. `scripts/measure-preload.ts` has one.

  Rule: The off-screen unit's files arrive with the page

    Background:
      Given the qa channel points at build "tasks"

    @browser @test-channel
    Scenario: The board's files are in the browser before the board is opened
      The whole mechanism, in one reading. `board` is placed on `/board` and
      nothing on `/` imports it, so an entry for its bundle on the landing page
      can only have come from a tag the shell emitted.

      When a visitor opens the frame
      Then the browser has already fetched "board", started by the page itself
      And nothing on the landing view imported "board"

    @browser @test-channel
    Scenario: Opening the board costs no second fetch of its files
      The other half, and it is the half a count alone cannot read. There is one
      timing entry per file either way; what says the import reused the warmed
      response is that the entry is still the one the tag started.

      When a visitor opens the frame
      And they open the board view
      Then each of "board"'s files was fetched once
      And the browser has already fetched "board", started by the page itself

    @browser @test-channel
    Scenario: The week's files are in the browser before the week is opened
      The second off-screen unit, `PLAN.md` step 5. Written because a cold read
      on 2026-09-13 found `seeing-the-week.feature` pointing here for the
      reading and this file holding none: every scenario above names `board`,
      so the requirement was a cross-reference to a scenario nobody had written.

      When a visitor opens the frame
      Then the browser has already fetched "week", started by the page itself
      And nothing on the landing view imported "week"

    @browser @test-channel
    Scenario: Opening the week costs no second fetch of its files
      When a visitor opens the frame
      And they open the week view
      Then each of "week"'s files was fetched once
      And the browser has already fetched "week", started by the page itself

    @browser @test-channel
    Scenario: Both off-screen units are warmed by one load
      One reading rather than two, because the claim the shell makes is about
      every unit the composition carries and not about a favourite. A page that
      warmed the first sub-app it found would satisfy both scenarios above.

      When a visitor opens the frame
      Then the browser has already fetched "board", started by the page itself
      And the browser has already fetched "week", started by the page itself
      And nothing on the landing view imported "board"
      And nothing on the landing view imported "week"

  Rule: A unit no view places is not warmed

    The check has teeth in both directions. `falsify` warms a file no view
    places and this is what goes red for it.

    Background:
      Given the qa channel points at build "alpha"

    @live @local
    Scenario: The page warms exactly the units its views place
      When a visitor loads the qa origin
      Then the page asks the browser to warm "list, board, week", and nothing else
