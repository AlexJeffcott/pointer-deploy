Feature: Keeping a list of tasks
  As one person planning my own work
  I want to add tasks, tag them and take them off the list
  So that the planner holds the work I mean to do

  `PLAN.md` step 1. `list` is the second unit: its own bundle, built, published
  and promoted on its own, placed by the shell on `/`. It owns no state. The
  shell owns the task store and hands it down, so what the panel draws and what
  the planner holds are one fact rather than two readings that can disagree.

  Where the tasks are KEPT is step 2's subject and has moved to
  `keeping-the-planner-in-the-browser.feature`: the shell reads them out of
  IndexedDB and writes them back, and the sentence this panel used to carry
  about a reload losing them is now one of two, chosen by what the frame reports.
  Nothing in this file changed when that landed, which is the claim it was
  written to make - `list` draws the store and does not know where the store
  keeps what it holds.

  Rule: A panel that writes into the frame's store

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A planner nobody has used yet holds no tasks
      Then the list holds no tasks

    @browser @test-channel
    Scenario: A task added through the panel is drawn by the list
      The panel writes into a signal the SHELL's bundle created, and redraws
      because both bundles resolve one Preact through the page's import map. A
      panel carrying its own copy would write the task and never draw it.

      When they add the task "Book the ferry"
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: A second task joins the first rather than replacing it
      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      Then the list holds "Book the ferry, Renew the passport"

    @browser @test-channel
    Scenario: A task is given tags, and the list draws them
      Typed one key at a time, which is the only way this measures anything. A
      control driven off the store alone rewrote its own value between
      keystrokes and erased the comma as it was typed, and a step that set the
      whole string in one event was green on it.

      When they add the task "Book the ferry"
      And they tag "Book the ferry" with "travel, summer"
      Then "Book the ferry" carries the tags "travel, summer"
      And the tag box for "Book the ferry" reads "travel, summer"

    @browser @test-channel
    Scenario: A second tag is typed onto a task that already has one
      The separator has to survive being typed. Between the comma and the first
      letter of the second tag there is a moment when the store holds one tag
      and the box holds "travel, " - and a box that is redrawn from the store at
      that moment loses what the visitor is in the middle of writing.

      When they add the task "Book the ferry"
      And they tag "Book the ferry" with "travel"
      And they go on typing ", summer" after the tags on "Book the ferry"
      Then "Book the ferry" carries the tags "travel, summer"
      And the tag box for "Book the ferry" reads "travel, summer"

    @browser @test-channel
    Scenario: Tagging one task leaves every other task untagged
      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they tag "Book the ferry" with "travel"
      Then "Book the ferry" carries the tags "travel"
      And "Renew the passport" carries no tags

    @browser @test-channel
    Scenario: A task taken off the list leaves, and the rest stay
      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they take "Book the ferry" off the list
      Then the list holds "Renew the passport"

  Rule: The store is the frame's, and the panel is a view of it

    The claim the whole composition rests on, one bundle short of the two
    sub-apps `PLAN.md` step 4 brings: the panel is unmounted and mounted again
    by the frame's router, and what it drew is still there - because it never
    held it.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: The tasks survive the panel being unmounted
      When they add the task "Book the ferry"
      And they open the board view
      And they open the tasks view
      Then the list holds "Book the ferry"

  Rule: What survives a reload is not this file's subject

    Step 1 had a scenario here saying a reload starts the planner empty, written
    so that step 2 would change a scenario rather than fill in a silence. Step 2
    changed it: it is "A task is still there after a reload" in
    `keeping-the-planner-in-the-browser.feature`, and its opposite is gone
    because it is no longer true.
