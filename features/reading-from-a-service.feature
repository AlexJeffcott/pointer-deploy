Feature: Reaching a service on its own deploy schedule
  As an operator
  I want the page to be told where the service is and whether it can use it
  So that a fourth deploy schedule is a thing I can read rather than guess at

  `PLAN.md` step 6 changed what the service is FOR and not how the page finds
  it. The server names the service, the policy permits that host and no other,
  and the page takes one reading of whether the version it was built against
  answers. What the page then does with the service is push a planner into it
  and pull one back, and the last Rule here is that pair.

  The service holds no planner in its own memory. It holds a bucket key, and the
  bucket holds the snapshots - a second bucket and a second key, because the
  asset bucket's key can write the files the origin executes. `bun run
  verify:keys` is where that is measured rather than asserted.

  Rule: What the server tells the page

    Background:
      Given the qa channel points at build "alpha"

    @local
    Scenario: A server that names a service tells the page where it is
      Given a service that answers "v1"
      When a visitor loads the qa origin
      Then the shell names that service as the one to read

    @local
    Scenario: A server with no service configured tells the page nothing
      When a visitor loads the qa origin
      Then the shell names no service

    @local
    Scenario: A shell that records no API version is not judged
      Given a service that answers "v1"
      When a visitor loads the qa origin
      Then the origin reports the API gate as "unread"

    @local
    Scenario: A server that names a service permits the page to reach it
      Given a service that answers "v1"
      When a visitor loads the qa origin
      Then the shell's policy permits that service and no other host

    @local
    Scenario: A server with no service permits the page to reach nothing
      When a visitor loads the qa origin
      Then the shell's policy permits nothing to be fetched

  Rule: What a browser then does with that policy

    The reading a policy cannot give on its own. The @local scenarios read the
    header the server writes; this one reads what a browser does with it, which
    is where a page that is told where the service is and forbidden to call it
    shows the difference. It runs against whatever the channel serves, so it
    asserts nothing about which shell that is.

    @browser
    Scenario: The page is permitted to reach the service it was told about
      Given a visitor opens the frame
      Then the page is allowed to fetch from that service
      But it is not allowed to fetch from the store

    @browser
    Scenario: The frame redraws when the reading it took of the service arrives
      The first paint happens before the service has answered, so `/service`
      starts as "unread" and fills in afterwards. That it fills in at all is the
      whole shared-runtime claim, one bundle short: the store is a signal the
      shell's bundle created, the frame reads it through an accessor, and an
      accessor that read without subscribing would leave this view saying
      "unread" for as long as the tab is open.

      Given a visitor opens the frame
      When they open the service view
      Then the frame draws the reading it took of the service

  Rule: The planner goes to the service, and comes back by its address

    `PLAN.md` step 6, and the two doors that make the service hold something
    worth holding. Push writes the planner into the bucket under the hash of its
    own bytes and hands back that hash. Pull reads one back and replaces every
    task with what it held.

    An address is the whole of the permission: there is no account, no login and
    no user record anywhere, so anyone holding it can read that planner. The
    page says so in those words.

    Pull is a TOTAL overwrite and never a merge, by the same rule an import is,
    and the rule is the same code: `readDocument` is `JSON.parse` and then
    `readPlanner`, and the pull door calls the second of those on what the
    service answered. A snapshot this shell cannot read is refused BY NAME and
    nothing is written.

    Background:
      Given the qa channel points at build "tasks"
      And a visitor opens the tasks view

    @browser @test-channel
    Scenario: Pushing the planner hands back an address
      When they add the task "Book the ferry"
      And they open the backup view
      And they push the planner
      Then the backup view names an address

    @browser @test-channel
    Scenario: A second browser pulls that address and holds the same tasks
      The claim the whole step exists for, and the boundary it has to cross:
      the second browser has its own IndexedDB and has never seen these tasks.
      What arrives is what the service kept. Step 7 gives the address a stable
      name and a write key, so the SAME address can be moved; this one is the
      address being the bytes.

      When they add the task "Book the ferry"
      And they add the task "Renew the passport"
      And they open the backup view
      And they push the planner
      And a second browser opens the tasks view
      Then the list holds no tasks
      When they open the backup view
      And they pull the address they were given
      Then the backup view reads 2 tasks out of the snapshot
      When they open the tasks view
      Then the list holds "Book the ferry, Renew the passport"

    @browser @test-channel
    Scenario: Pulling replaces every task that was there
      The overwrite at its sharpest, in one browser: the tasks that were here
      are not in the snapshot, and they are gone. A merge would leave them.

      When they add the task "Book the ferry"
      And they open the backup view
      And they push the planner
      And they open the tasks view
      And they take "Book the ferry" off the list
      And they add the task "Mend the fence"
      And they open the backup view
      And they pull the address they were given
      And they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: A snapshot a newer shell pushed is refused, and both versions are named
      What a rollback produces, on the third of the four doors. The browser
      enforces a version on the database and nothing enforces one here, so the
      shell must - which it can only do because `v1` answers with the schema
      version the push declared. A response carrying tasks alone would leave
      this door reading a newer planner as its own.

      Given the service holds a planner a newer shell wrote
      When they add the task "Book the ferry"
      And they open the backup view
      And they pull that address
      Then the refusal of the snapshot names "schemaVersion, 9"
      When they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: A snapshot that was never a planner is refused, and the field is named
      The service takes any JSON object and writes it under the hash of its own
      bytes, so a stranger can hand over an address holding anything. Without
      the format on the wire this pulls as a planner with no tasks in it, and
      the overwrite empties the browser it was pulled into.

      Given the service holds something that was never a planner
      When they add the task "Book the ferry"
      And they open the backup view
      And they pull that address
      Then the refusal of the snapshot names "format"
      When they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: An address the service holds nothing at is refused, and nothing changes
      When they add the task "Book the ferry"
      And they open the backup view
      And they pull the address "0000000000000000000000000000000000000000000000000000000000000000"
      Then the backup view refuses the snapshot
      When they open the tasks view
      Then the list holds "Book the ferry"

    @browser @test-channel
    Scenario: An address that could not be an address is refused by the service
      A snapshot is written under the sha256 of its own bytes, so an address
      that is not one addresses nothing the service ever wrote. It is refused by
      shape, before any bucket is read.

      When they add the task "Book the ferry"
      And they open the backup view
      And they pull the address "latest"
      Then the refusal of the snapshot names "digest"
      When they open the tasks view
      Then the list holds "Book the ferry"
