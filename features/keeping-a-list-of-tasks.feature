Feature: Keeping a list of tasks
  As one person planning my own work
  I want to add tasks, tag them and take them off the list
  So that the planner holds the work I mean to do

  `PLAN.md` step 1. `list` is the second unit: its own bundle, built, published
  and promoted on its own, placed by the shell on `/`. It owns no state. The
  shell owns the task store and hands it down, so what the panel draws and what
  the planner holds are one fact rather than two readings that can disagree.

  The tasks are in memory and nowhere else, and that is the step rather than an
  omission: IndexedDB arrives at step 2, so a reload starts the planner empty.
  The panel says so on the page, in those words, so that a visitor is told
  rather than left to find out.

  Rule: A panel that writes into the frame's store

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A planner nobody has used yet holds no tasks
      Then the list holds no tasks
      And the panel says the tasks are kept in this page alone

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

  Rule: In memory, and nowhere else

    Step 2 puts the planner in IndexedDB. Until it does, the store is a signal
    in one page and a reload is the end of it. Said here as a requirement so
    that step 2 changes a scenario rather than filling in a silence.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A reload starts the planner empty again
      When they add the task "Book the ferry"
      And they load the page again
      Then the list holds no tasks
