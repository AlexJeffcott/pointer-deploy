Feature: Keeping the planner in the browser
  As one person planning my own work
  I want the tasks I typed to still be there tomorrow
  So that the planner is worth typing into

  `PLAN.md` step 2. The shell opens IndexedDB `pointer-planner`, reads the tasks
  out of it at startup and writes them back on every change. `list` does not
  change: it draws the shell's store and writes through it, and it does not know
  where the store keeps what it holds. That is the point of the store being the
  shell's.

  The database is version 1: `tasks`, keyed on `id`, and `meta`, keyed on `key`,
  holding `schemaVersion` and `writtenAt`. Step 14 adds version 2 and the
  forward upgrade, and step 16 changes how the database is OPENED. Until then
  this shell opens at the one version it knows, which is what gives step 15 a
  failure to show.

  Nothing is sent anywhere. The planner is in this browser and in no other, and
  the panel says so in those words - the sentence step 1 put on the page changes
  here rather than going quiet.

  Rule: The tasks outlive the page

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A task is still there after a reload
      When they add the task "Book the ferry"
      And they load the page again
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: The order the tasks were added in survives a reload
      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they load the page again
      Then the list holds "Book the ferry, Renew the passport"

    @browser @test-channel
    Scenario: Tags survive a reload
      When they add the task "Book the ferry"
      And they tag "Book the ferry" with "travel, summer"
      And they load the page again
      Then "Book the ferry" carries the tags "travel, summer"

    @browser @test-channel
    Scenario: A task taken off the list stays off after a reload
      A removal is a write like any other. A planner that forgets a deletion
      brings the task back on the next visit, which is worse than not storing
      anything.

      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they take "Book the ferry" off the list
      And they load the page again
      Then the list holds "Renew the passport"

  Rule: In this browser, and in no other

    The planner is per browser because IndexedDB is. Step 7 is where two
    browsers see one planner, and it gets there by pushing a snapshot through a
    slot rather than by anything written here.

    Background:
      Given the qa channel points at build "tasks"

    @browser @test-channel
    Scenario: A browser that has never opened the planner starts empty
      Given a visitor opens the tasks view
      Then the list holds no tasks

    @browser @test-channel
    Scenario: What one browser stored is not in another browser
      Given a visitor opens the tasks view
      And they add the task "Book the ferry"
      When a second browser opens the tasks view
      Then the list holds no tasks

    @browser @test-channel
    Scenario: The panel says where the tasks are kept
      Given a visitor opens the tasks view
      Then the panel says the tasks are kept in this browser alone

  Rule: The database is the shell's, and it is version 1

    Read out of the database rather than off the page. Every other scenario here
    drives the panel and reads the panel, which is what measures the
    composition; these two measure the thing the composition writes into, and a
    step that read the panel could not tell a stored task from a task still in a
    signal.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: A task added through the panel is in the database
      When they add the task "Book the ferry"
      Then the database "pointer-planner" holds the task "Book the ferry"

    @browser @test-channel
    Scenario: The database records the schema version it was written at
      When they add the task "Book the ferry"
      Then the database "pointer-planner" is at schema version 1

  Rule: A planner that cannot be stored is still a planner

    A browser can refuse IndexedDB - a private window, a blocked origin, a
    setting - and the shell is not entitled to fail because of it. It degrades
    to what step 1 had: the tasks in one page, and the page saying so. This is
    the same rule step 16 applies to a database written by a newer shell, and it
    is built here because the failure it covers exists from this step onwards.

    Background:
      Given the qa channel points at build "tasks"
      And this browser refuses IndexedDB

    @browser @test-channel
    Scenario: The list still works when the planner cannot be stored
      Given a visitor opens the tasks view
      When they add the task "Book the ferry"
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: The panel says the planner is not being stored
      Given a visitor opens the tasks view
      Then the panel says the tasks are kept in this page alone

  Rule: The page does not claim to be empty before it has looked

    Reading the database is asynchronous and the first paint is not. A panel
    that draws "No tasks yet" and then fills in has told the visitor something
    false, and a scenario that read the list at that moment would agree with it.

    The open is slowed on purpose, and without that this rule measures nothing.
    Measured on 2026-09-11: `list` is fetched and imported after the shell
    paints, so IndexedDB is open before the panel first renders, and a mutation
    that drew the empty message while the planner was unread stayed green. Step
    4 preloads a unit off the landing route, which is where the margin starts to
    close on its own.

    Background:
      Given the qa channel points at build "tasks"
      And the planner is slow to open

    @browser @test-channel
    Scenario: The empty message waits for the planner to be read
      Given a visitor opens the tasks view
      Then the panel says it is reading the planner
      And the panel said nothing about being empty before the planner was read
