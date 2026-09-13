Feature: Seeing the week
  As one person planning my own work
  I want seven days and a way to put a task on one
  So that I can see what is due when, and move a task to another day

  `PLAN.md` step 5. `week` is the fourth unit and the last on this slate: its
  own bundle, built, published and promoted on its own, placed by the shell on
  `/week`. It is the SECOND unit placed off the landing route, so the page now
  warms two bundles rather than one - measured in
  `warming-a-unit-before-its-view.feature`, not here.

  A week runs Monday to Sunday. Not "the next seven days": a rolling window
  moves a task to a different panel overnight for no reason a person did
  anything about. Which seven days it is, is this unit's own reading of the
  clock and is NOT on the contract surface. `columns()` is on it because the
  board draws one panel per column and two units have to agree on the set;
  nothing has to agree with a week.

  `setDue` is this unit's own member and nothing else on the slate calls it,
  which is what step 10 demonstrates by dropping such a member: the promote
  refuses one unit and names it, and leaves the other two alone.

  Every scenario here names a day by its POSITION in the week rather than by a
  date. A scenario carrying `2026-12-25` reads correctly until December and then
  starts measuring something else, and nobody would be told.

  Rule: Seven days, and a task on one of them

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A planner nobody has used yet has seven empty days
      When they open the week view
      Then the week draws 7 days
      And every day of the week is empty
      And the week holds 0 tasks with no date

    @browser @test-channel
    Scenario: A new task has no date
      The list decides nothing about when a task is due. `addTask` gives it no
      date at all, and the week is where that is visible: it is on the page,
      under No date, and on no day.

      When they add the task "Book the ferry"
      And they open the week view
      Then "Book the ferry" has no date
      And every day of the week is empty

    @browser @test-channel
    Scenario: A task put on a day is drawn on it
      When they add the task "Book the ferry"
      And they open the week view
      And they put "Book the ferry" on day 3 of the week
      Then "Book the ferry" is on day 3 of the week
      And the week holds 0 tasks with no date

    @browser @test-channel
    Scenario: A task moved to another day leaves the one it was on
      Both halves, because a write that COPIED would satisfy the first alone and
      draw the task on two days.

      When they add the task "Book the ferry"
      And they open the week view
      And they put "Book the ferry" on day 1 of the week
      And they put "Book the ferry" on day 5 of the week
      Then "Book the ferry" is on day 5 of the week
      And day 1 of the week is empty

    @browser @test-channel
    Scenario: A date taken off a task puts it back under No date
      `null` is a value and not a missing argument. There is no second member
      for clearing a date, so this is the same write with a different value.

      When they add the task "Book the ferry"
      And they open the week view
      And they put "Book the ferry" on day 2 of the week
      And they take the date off "Book the ferry"
      Then "Book the ferry" has no date
      And day 2 of the week is empty

    @browser @test-channel
    Scenario: Dating one task leaves the others where they are
      A write that dated every task looks correct with one task on the page,
      which is what the first step of every other scenario here leaves.

      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they open the week view
      And they put "Book the ferry" on day 4 of the week
      Then "Book the ferry" is on day 4 of the week
      And "Renew the passport" has no date
      And the week holds 1 task with no date

    @browser @test-channel
    Scenario: A date survives a reload
      The planner is in IndexedDB and a date is a field of a task, so it is
      written by the same one transaction the title was.

      When they add the task "Book the ferry"
      And they open the week view
      And they put "Book the ferry" on day 6 of the week
      And they load the week again
      Then "Book the ferry" is on day 6 of the week

  Rule: Three separately published panels over one collection

    What `PLAN.md` step 5 adds to step 4's claim, and the reason this step is on
    the slate at all: `list`, `board` and `week` are THREE units, built and
    published on their own, over one store and one signals runtime. None owns a
    task. Each is handed the shell's store, and a write through one is drawn by
    the others.

    They never share a view, so nothing here measures a panel redrawing because
    another panel wrote. No view on this slate places two units and none will,
    so that reading has no subject anywhere - TODO §31 row 3.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A task added on the list can be dated on the week
      When they add the task "Book the ferry"
      And they open the week view
      And they put "Book the ferry" on day 2 of the week
      And they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: A task dated on the week keeps its date when the board moves it
      Three units writing one task through three members, and none of them
      losing another's work. Each panel rebuilds the record it writes, so a
      write that dropped a field shows here and nowhere else.

      When they add the task "Book the ferry"
      And they open the week view
      And they put "Book the ferry" on day 3 of the week
      And they open the board view
      And they move "Book the ferry" to "doing"
      And they open the week view
      Then "Book the ferry" is on day 3 of the week

    @browser @test-channel
    Scenario: A tag written on the list survives a date written on the week
      When they add the task "Book the ferry"
      And they tag "Book the ferry" with "travel"
      And they open the week view
      And they put "Book the ferry" on day 1 of the week
      And they open the tasks view
      Then "Book the ferry" carries the tags "travel"

    @browser @test-channel
    Scenario: A task dated on the week is on the board where it was
      A date is not a column. The two members write different fields of one
      record, and neither is a second reading of the other.

      When they add the task "Book the ferry"
      And they open the week view
      And they put "Book the ferry" on day 7 of the week
      And they open the board view
      Then "Book the ferry" is in the "todo" column

  Rule: Every task the planner holds is on this page once

    A task is on a day, under No date, or under Another date, and never in two
    of them and never in none. Without the last of those the page can hold fewer
    tasks than the planner does and say nothing: the week draws a count per day
    rather than a total, so every number on the page agrees while a task is
    missing from all of them. That is the shape the board's own report was built
    for at step 4.

    Two doors that WRITE a date are guarded. `setDue` refuses anything that is
    not `YYYY-MM-DD`, or names a day that does not exist, silently - the control
    on the page is a select whose options are the seven days, so nothing there
    produces one. `readDocument` refuses a document carrying one by name, and
    that door is the one a person reaches with a text editor.

    IndexedDB is a third door and nothing guards it, for the reason `PLAN.md`
    gives for the whole planner at steps 15 and 16: a shell that deleted a task
    it did not understand would be destroying data it is not entitled to. So the
    page reports instead, and prints the value the task actually carries - a
    date outside the week reads as a date, and a value that is not a date reads
    as itself, which is the only honest thing this panel can say about one.
    TODO §46 is the door; this is what stands in front of it.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the week view

    @browser @test-channel
    Scenario: A task dated outside this week is reported with the date it carries
      Sixty days out rather than a date written into this file. A scenario
      carrying a fixed date measures "not in this week" until that week arrives.

      When the planner is given a task dated 60 days from now
      And they load the week again
      Then the week reports 1 task dated another day
      And the control on "Learn to sail" offers the date it carries
      And every day of the week is empty

    @browser @test-channel
    Scenario: A task whose date is not a date at all is reported as it is
      The state TODO §46 is about, arranged the only way it can be reached: a
      write straight into the database. A later shell, or a rollback onto data a
      newer shell wrote, reaches it without anybody typing anything.

      When the planner is given a task dated "yesterday"
      And they load the week again
      Then the week reports 1 task dated another day
      And the week prints "yesterday" beside that task
      And every day of the week is empty

    @browser @test-channel
    Scenario: A task reported as dated another day can be brought into the week
      The report is not a dead end. The control on that card is the control on
      every other one, so the value the week could not place is replaced by one
      it can.

      When the planner is given a task dated 60 days from now
      And they load the week again
      And they put "Learn to sail" on day 4 of the week
      Then "Learn to sail" is on day 4 of the week
      And the week reports 0 tasks dated another day

    @browser @test-channel
    Scenario: Every task is drawn once, whichever group it falls in
      One reading of the whole page, taken off the rendered DOM rather than off
      the counts the panel drew: the cards on the page are counted and compared
      with the number of tasks the planner holds. A task in no group and a task
      in two both fail it.

      When the planner is given a task dated 60 days from now
      And they load the week again
      And they open the tasks view
      And they add the task "Book the ferry"
      And they open the week view
      And they put "Book the ferry" on day 5 of the week
      And they open the tasks view
      And they add the task "Renew the passport"
      And they open the week view
      Then every task the planner holds is drawn once on the week

  Rule: The week waits for the planner to be read

    `PLAN.md` step 2's requirement, on the panel `PLAN.md` finishes the slate
    with. Seven empty days drawn on the first paint tell a visitor with a full
    planner that nothing is due, and the finished page is correct - so the
    reading has to be taken as it happens.

    The open is slowed on purpose, and without that this rule measures nothing.
    TODO §41 is the class: a panel is fetched and imported after the shell
    paints, so IndexedDB is nearly always open before it first renders. The warm
    is not the variable - this scenario LANDS on `/week`, where `week` is warmed
    and imported in the same load.

    @browser @test-channel
    Scenario: The week says it is reading before the planner has been read
      Given the qa channel points at build "tasks"
      And the planner is slow to open
      When a visitor opens the week view
      Then the week says it is reading the planner
      And the week said no day was empty before the planner was read
