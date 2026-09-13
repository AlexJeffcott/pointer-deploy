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

  Rule: A unit no view places is not warmed

    The check has teeth in both directions. `falsify` warms a file no view
    places and this is what goes red for it.

    Background:
      Given the qa channel points at build "alpha"

    @live @local
    Scenario: The page warms exactly the units its views place
      When a visitor loads the qa origin
      Then the page asks the browser to warm "list, board, week", and nothing else
