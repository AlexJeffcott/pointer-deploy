Feature: Reading what is inside the service, and what is going away
  As an operator moving a field
  I want the service to publish what it holds and what it is retiring
  So that a page says so without anybody rebuilding a unit

  The two surfaces inside this repository have a compiler behind them. This one
  does not: the service is a separate app on its own deploy schedule, so what it
  holds this afternoon is a fact about the running world and has to be asked for
  rather than derived. These scenarios drive the service itself. What the page
  then does with the answer is `bun run e2e:schema`, which needs a browser.

  `PLAN.md` step 6 changed the subject and not the mechanism. `greeting` was the
  smallest thing this service could hold while the slate had no data to move;
  snapshots are what it holds now, and every reading below is the one that was
  taken of the greeting, re-aimed.

  The service spawned here holds NO bucket credential, so its snapshots are in
  the memory of that one process. That is deliberate and it is not only speed:
  the credential in the environment of a person running this suite is the ASSET
  bucket's, and a service handed it would write planners into the bucket the
  origin executes.

  Rule: The service says what is inside each version it answers

    @local
    Scenario: The document names the fields, and keeps the member older shells read
      Given a service that answers "v1"
      When the service is asked what it holds
      Then it still names "v1" among the versions it serves
      And it names "snapshot.tasks" as a field of "v1"
      And nothing in "v1" is going away

    @local
    Scenario: A version it does not answer is not described
      Given a service that answers "v1"
      When the service is asked what it holds
      Then it describes no version it does not answer

    @local
    Scenario: The version answers at its own root, and a version it does not serve does not
      The reading a page takes to find out that the version it was BUILT against
      is answered by the deploy in front of it. The discovery document cannot
      give it: `/versions` sits outside every version prefix, so it says what
      this deploy claims and not whether a request at `/v1` lands. Every other
      route here is addressed by an id.

      Given a service that answers "v1"
      When a page asks for the version this shell calls
      Then the version answers with its own routes and fields
      And a version it does not answer is not found

  Rule: A retirement is an operator's decision, and no code change

    @local
    Scenario: A retired field is named in the document, with the day it goes
      Given a service that answers "v1" and retires "snapshot.tasks" on "2026-12-10"
      When the service is asked what it holds
      Then it says "snapshot.tasks" goes on "2026-12-10"
      And it gives a reason for retiring "snapshot.tasks"
      And it still answers "snapshot.tasks"

    @local
    Scenario: A retirement naming a field the service does not answer stops it
      Given a service told to retire "snapshot.taks", which it does not answer
      Then it refuses to start, and names what it does answer

    @local
    Scenario: A retirement the service cannot parse stops it
      Given a service told to retire something that is not JSON
      Then it refuses to start, and says which part it could not read

  Rule: Every response carrying a retired field says so

    @local
    Scenario: The two headers, on the responses that carry the field
      Given a service that answers "v1" and retires "snapshot.tasks" on "2026-12-10"
      When a page pushes a planner to that service
      Then that response is marked deprecated and sunset on "2026-12-10"
      And it points at the document for the reason

    @local
    Scenario: The version's own root carries the retirements inside it
      The one call every page makes. A page that has pushed nothing has made no
      other data request, so without this the header reading would be null on
      every page until somebody pressed Push.

      Given a service that answers "v1" and retires "snapshot.tasks" on "2026-12-10"
      When a page asks for the version this shell calls
      Then that response is marked deprecated and sunset on "2026-12-10"

    @local
    Scenario: A response is not marked while nothing is going away
      Given a service that answers "v1"
      When a page pushes a planner to that service
      Then that response is not marked deprecated

    @local
    Scenario: A page on another origin is allowed to read the two headers
      Given a service that answers "v1"
      When a page pushes a planner to that service
      Then another origin is permitted to read the sunset

  Rule: A planner goes in, and comes back out at the address it was given

    The unit tests call the handler directly. These drive the running process,
    because what they are for is the planner SURVIVING one request and being
    read by the next - which a handler called twice in one function cannot show.

    @local
    Scenario: A planner pushed is a planner the next reader gets back
      Given a service that answers "v1"
      When a page pushes a planner holding "Book the ferry"
      And a page reads that address back
      Then the planner that comes back holds "Book the ferry"
      And it carries the format and the schema version that were pushed

    @local
    Scenario: The address is the hash of the planner, so pushing twice costs one
      Two pushes of one planner are one address. That is the same mechanism as
      a unit id, on data instead of code, and it is what makes an address a
      claim about bytes rather than a name somebody chose.

      Given a service that answers "v1"
      When a page pushes a planner holding "Book the ferry"
      And the same planner is pushed again
      Then both pushes name one address

    @local
    Scenario: An address nobody pushed to holds nothing
      Given a service that answers "v1"
      When a page reads an address nothing was pushed to
      Then the service says it holds nothing there

    @local
    Scenario: A body that is not a planner is refused, and nothing is kept
      The bucket is written on the strength of one unauthenticated request, so
      what the service will take at all is the first thing standing in front of
      it.

      Given a service that answers "v1"
      When a page pushes something that is not a JSON object
      Then the service refuses it, saying "body is not a JSON object"

    @local
    Scenario: An address that could not be one is refused before anything is read
      A snapshot is written under the sha256 of its own bytes, so an address
      that is not a sha256 addresses nothing this service ever wrote. Refusing
      it by shape keeps a bucket read off the path of anything a stranger types.

      Given a service that answers "v1"
      When a page reads the address "latest"
      Then the service refuses it, saying "digest is not a sha256"
