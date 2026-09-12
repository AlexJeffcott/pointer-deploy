Feature: Moving a task between columns
  As one person planning my own work
  I want a board of columns and a way to move a task between them
  So that I can see what is waiting, what I am doing and what is finished

  `PLAN.md` step 4. `board` is the third unit: its own bundle, built, published
  and promoted on its own, placed by the shell on `/board`. It is the first unit
  placed on a route a visitor does not land on, which is what gives the shell's
  preload tags a subject - measured in
  `warming-a-unit-before-its-view.feature`, not here.

  There is no done flag on a task. A task is done when it is in the last column,
  so the board and the list cannot hold two readings of one fact.

  `columns()` and `moveTask()` are this unit's own members. Nothing else on the
  slate calls either, which is what step 10 drops `moveTask` to demonstrate: the
  promote refuses `board` and names it, and leaves `list` alone.

  Rule: A board of fixed columns

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A planner nobody has used yet has an empty column for each column
      When they open the board view
      Then the board draws the columns "To do, Doing, Done"
      And every column on the board is empty

    @browser @test-channel
    Scenario: A new task starts in the first column
      The list decides nothing about where a task lands. `addTask` puts it in
      the first column the shell draws, and the board is where that is visible.

      When they add the task "Book the ferry"
      And they open the board view
      Then "Book the ferry" is in the "todo" column

    @browser @test-channel
    Scenario: A task moved to another column leaves the one it was in
      Both halves, because a move that COPIED would satisfy the first alone and
      draw the task twice.

      When they add the task "Book the ferry"
      And they open the board view
      And they move "Book the ferry" to "doing"
      Then "Book the ferry" is in the "doing" column
      And the "todo" column is empty

    @browser @test-channel
    Scenario: Moving one task leaves the others where they are
      A move that rewrote every task looks correct with one task on the board,
      which is what the first step of every other scenario here leaves.

      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they open the board view
      And they move "Book the ferry" to "done"
      Then "Book the ferry" is in the "done" column
      And "Renew the passport" is in the "todo" column

    @browser @test-channel
    Scenario: A task crosses the whole board and ends up done
      When they add the task "Book the ferry"
      And they open the board view
      And they move "Book the ferry" to "doing"
      And they move "Book the ferry" to "done"
      Then "Book the ferry" is in the "done" column
      And the board counts 0 tasks in "todo", 0 in "doing" and 1 in "done"

  Rule: Two separately published panels over one collection

    The claim `PLAN.md` step 1 could make one bundle short of, and the one the
    whole composition rests on: `list` and `board` are two units, built and
    published on their own, and there is one planner between them. Neither owns
    a task. The store is the shell's, both are handed it, and a write through
    one is drawn by the other.

    They never share a view, so nothing here measures a panel redrawing because
    another panel wrote. What it measures is one collection: the two sets of
    controls write into one store and each panel draws what came back.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A task added on the list is on the board
      When they add the task "Book the ferry"
      And they open the board view
      Then "Book the ferry" is in the "todo" column

    @browser @test-channel
    Scenario: A task moved on the board is still on the list
      The list draws every task the planner holds and says nothing about
      columns, so a move must change where the task is and not whether it is.

      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they open the board view
      And they move "Book the ferry" to "done"
      And they open the tasks view
      Then the list holds "Book the ferry, Renew the passport"

    @browser @test-channel
    Scenario: A tag written on the list survives a move on the board
      Two units writing one task through two members, and neither losing the
      other's work: the panel that moves it rebuilds the record, so a move that
      dropped a field would show here and nowhere else.

      When they add the task "Book the ferry"
      And they tag "Book the ferry" with "travel"
      And they open the board view
      And they move "Book the ferry" to "doing"
      And they open the tasks view
      Then "Book the ferry" carries the tags "travel"

  Rule: A task the board cannot draw is reported, never hidden

    Two doors that WRITE a column are guarded: `moveTask` refuses a column no
    column names, silently, because no control on the board can produce one, and
    `readDocument` refuses a document carrying one by name. IndexedDB is a third
    door and nothing guards it - a shell that deleted a task it did not
    understand would be destroying data it is not entitled to, which is the rule
    `PLAN.md` states for the whole planner at steps 15 and 16.

    So the board reports instead. Without this the task is in the planner, on
    the list, on no panel here, and nothing anywhere on the page says so - and
    the board draws per-column counts rather than a total, so the numbers all
    agree. TODO §46 is the door; this is what stands in front of it.

    Arranged, and said to be arranged: a later shell's columns reach this state,
    and so does a rollback onto data a newer shell wrote. Neither exists yet.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the board view

    @browser @test-channel
    Scenario: A task in a column the board does not draw is reported
      When the planner is given a task in the column "someday"
      And they load the board again
      Then the board reports 1 task it does not draw
      And every column on the board is empty

  Rule: The board waits for the planner to be read

    `PLAN.md` step 2's requirement, on the panel that is fetched last. A board
    that drew three empty columns on the first paint has told a visitor with a
    full planner that there is nothing on it, and the finished page is correct -
    so the reading has to be taken as it happens.

    The open is slowed on purpose, and without that this rule measures nothing.
    TODO §41 is the class: a panel is fetched and imported after the shell
    paints, so IndexedDB is nearly always open before it first renders.

    The warm is not the variable here, and a sentence saying it was stood in
    this file until a cold read on 2026-09-12. The scenario LANDS on `/board`,
    where `board` is warmed and imported in the same load, so what the warm
    changes is nothing a scenario can see. What it changes in general is the
    other direction from the one that sentence claimed: a warmed panel mounts
    SOONER, so it is more likely to render while the planner is unread, so the
    requirement is more reachable rather than less. `scripts/falsify.ts` says
    that, and this file said the opposite.

    Background:
      Given the qa channel points at build "tasks"
      And the planner is slow to open

    @browser @test-channel
    Scenario: The board says it is reading before the planner has been read
      Given a visitor opens the board view
      Then the board says it is reading the planner
      And the board said no column was empty before the planner was read

  Rule: A column is kept, like everything else in the planner

    Where a task IS is part of the planner, so it is in IndexedDB with the rest
    of it - `PLAN.md` step 2's claim, applied to a field step 4 is the first to
    move. Nothing in `board` knows about a database.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A move is still there after a reload
      When they add the task "Book the ferry"
      And they open the board view
      And they move "Book the ferry" to "doing"
      And they load the board again
      Then "Book the ferry" is in the "doing" column
