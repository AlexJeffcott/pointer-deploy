Feature: Backing up the planner
  As one person planning my own work
  I want the planner as one file I can keep
  So that clearing this browser is not the end of it

  `PLAN.md` step 3. The frame draws `/backup` itself - no unit is placed there
  and nothing is fetched for it - and it holds two of the four doors the planner
  document goes through. Export writes the document to disk. Import reads one
  back and replaces every task with what the file holds. Push and pull are the
  other two doors and arrive at steps 6 and 7.

  Import is a TOTAL overwrite and never a merge, in ONE IndexedDB transaction.
  A merge needs conflict rules, and manual sync between one person's own
  browsers generates none. One transaction is what makes an import that fails
  part-way leave the planner exactly as it was.

  Three of the four doors let in data this shell has never seen, and one rule
  covers all three: `format`, then `schemaVersion`, then the tasks. A file that
  fails any of them is refused BY NAME and nothing is written.

  No member was added to the contract for any of this. A sub-app cannot read a
  file, the frame writes what it read through `ShellStore.loadTasks`, and step 2
  already put that on the surface. A whole view arrived and the surface every
  unit is built against did not move.

  Rule: The planner comes out as one file

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: The exported file holds every task on the list
      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they open the backup view
      And they export the planner
      Then the exported file holds "Book the ferry, Renew the passport"

    @browser @test-channel
    Scenario: The exported file names the format and the schema version
      A file with no name and no version on it is a file nothing can refuse.
      The two fields every import reads first are the two an export writes.

      When they add the task "Book the ferry"
      And they open the backup view
      And they export the planner
      Then the exported file is a "pointer-planner" document at schema version 1
      And the exported file is named for the planner

    @browser @test-channel
    Scenario: A planner with nothing in it still comes out as a file
      An empty planner is a planner. A browser that exported nothing would
      leave a person with no way to say "this is the state I want back".

      When they open the backup view
      And they export the planner
      Then the exported file holds no tasks
      And the exported file is a "pointer-planner" document at schema version 1

  Rule: A file goes back in, over the top

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: An imported file replaces every task that was there
      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they open the backup view
      And they import a planner holding "Fix the gate"
      Then the backup view reads 1 tasks out of the file
      When they open the tasks view
      Then the list holds "Fix the gate"

    @browser @test-channel
    Scenario: Importing a planner with nothing in it empties the list
      The overwrite at its sharpest: the file holds nothing, so the planner
      holds nothing. A merge would leave both tasks where they were, and
      every other scenario in this Rule would pass while it did.

      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they open the backup view
      And they import a planner holding nothing
      Then the backup view says 0 tasks are held
      When they open the tasks view
      Then the list holds no tasks

    @browser @test-channel
    Scenario: What was imported is still there after a reload
      An import that reached the page alone would draw the same list and
      forget it on the next visit. This is the reading that says it went
      through the store and into the database.

      When they add the task "Book the ferry"
      And they open the backup view
      And they import a planner holding "Fix the gate, Mend the fence"
      And they open the tasks view
      And they load the page again
      Then the list holds "Fix the gate, Mend the fence"

    @browser @test-channel
    Scenario: A planner is exported, changed, and put back
      The round trip, through the real file and the real file input. Every
      other scenario here builds the document it imports; this one imports
      only what the page itself wrote.

      When they add the task "Book the ferry"
      And they open the backup view
      And they export the planner
      And they open the tasks view
      And they take "Book the ferry" off the list
      And they open the backup view
      And they import the file they exported
      And they open the tasks view
      Then the list holds "Book the ferry"

  Rule: A file this shell cannot read is refused, and nothing is written

    Every refusal names the field it read. "The file is wrong" sends a person
    to a text editor with nothing to look for.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view
      And they add the task "Book the ferry"
      And they open the backup view

    @browser @test-channel
    Scenario: A file that is not a planner at all is refused
      When they import a file holding "this is not a planner"
      Then the backup view refuses the file
      When they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: A file naming another format is refused, and the field is named
      When they import a file holding '{ "format": "todo-list", "schemaVersion": 1, "tasks": [] }'
      Then the refusal names "format, todo-list, pointer-planner"
      When they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: A file a newer shell wrote is refused, and both versions are named
      This is what a rollback produces: the code moves back and the file does
      not. `PLAN.md` steps 15 and 16 are the same asymmetry against the
      database rather than against a file, and the browser enforces that one.
      Nothing but this enforces it here.

      When they import a file holding '{ "format": "pointer-planner", "schemaVersion": 9, "tasks": [] }'
      Then the refusal names "schemaVersion, 9, 1"
      When they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: A file whose tasks are not tasks is refused, and the task is named
      Read to the end before anything is written. A document that is right
      about its format and its version and wrong about its ninth task must
      not leave a planner holding the first eight.

      When they import a file holding '{ "format": "pointer-planner", "schemaVersion": 1, "tasks": [{ "id": "a" }] }'
      Then the refusal names "tasks[0].title"
      When they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: A refused file leaves the database as it was
      The page is not the reading. A refusal that emptied the database and
      left the signal alone would draw the right list until the next visit.

      When they import a file holding '{ "format": "pointer-planner", "schemaVersion": 9, "tasks": [] }'
      Then the backup view refuses the file
      And the database holds only "Book the ferry"

  Rule: A write that fails part-way leaves the planner as it was

    The overwrite is one IndexedDB transaction: a clear, and then every task
    the file holds. A transaction that gives up rolls the clear back with the
    rest of it, which is the difference between a planner that is replaced and
    a planner that is lost. A quota that runs out and a disk that fails both
    arrive this way.

    What the page says is two readings and not one. The document WAS read and
    the tasks in this page WERE replaced, so the import line says so. Whether
    any of it reached the database is what the planner's own state says, and
    after this it says the planner is not being stored.

    Two ways a write fails, and the browser reports them differently. A
    transaction that gives up is rolled back by the browser. A record the
    browser refuses as it is QUEUED is not: the clear and every put before the
    refusal are already queued, and the transaction commits those - which is
    neither the planner that was there nor the one the file held. So
    `Planner.write` aborts by hand.

    The first of those is a failure a browser really produces: a quota that runs
    out, a disk that fails. **The second is not reachable from any input this
    shell has.** `readDocument` requires a non-empty string id and rebuilds
    every field as a primitive, so neither a bad key nor a failed structured
    clone can happen, and `addTask` mints its own ids. The second scenario
    arranges a throw that nothing produces. What it holds is the second line if
    that id rule ever loosens, which is why the id rule has a unit test of its
    own.

    Background:
      Given the qa channel points at build "tasks"

    @browser @test-channel
    Scenario: An import the database gives up on leaves every stored task where it was
      Given the database gives up part-way through a write
      And a visitor opens the tasks view
      When they add the task "Book the ferry"
      And they open the backup view
      And they import a planner holding "Fix the gate, Mend the fence, Paint the shed"
      Then the backup view says the planner is unstored
      And the database holds only "Book the ferry"

    @browser @test-channel
    Scenario: A record the database refuses leaves every stored task where it was
      An arranged throw, and the Rule above says why: no file reaches this. The
      clear is queued before any task is, so a write that simply stopped where
      the refusal happened would leave the transaction holding the clear and
      the two tasks queued before it, and the browser would commit that.

      Given the database refuses a record as it is written
      And a visitor opens the tasks view
      When they add the task "Book the ferry"
      And they open the backup view
      And they import a planner holding "Fix the gate, Mend the fence, Paint the shed"
      Then the backup view says the planner is unstored
      And the database holds only "Book the ferry"

  Rule: The backup view does not say what it has not read

    The requirement `list` carries, and this view needs it more. `list` is a
    separately published bundle, fetched and imported after the shell paints, so
    the planner is nearly always open before it first renders - which is TODO
    §41. This view is IN the shell bundle and `/backup` is landable directly, so
    it draws on the first paint.

    What the window would otherwise produce is a FILE. The planner holds nothing
    until the read lands, so an export taken here writes a valid, importable
    planner holding no tasks, and an import taken here is overwritten by the
    read that follows it.

    Background:
      Given the qa channel points at build "tasks"
      And the planner is slow to open

    @browser @test-channel
    Scenario: A cold landing on the backup view neither counts nor exports
      Given a visitor lands on the backup view
      Then the backup view says it is reading the planner
      And neither door is open
