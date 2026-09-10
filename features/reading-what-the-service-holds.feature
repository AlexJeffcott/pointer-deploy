Feature: Reading what is inside the service, and what is going away
  As an operator moving a field
  I want the service to publish what it holds and what it is retiring
  So that a page says so without anybody rebuilding a unit

  The two surfaces inside this repository have a compiler behind them. This one
  does not: the service is a separate app on its own deploy schedule, so what it
  holds this afternoon is a fact about the running world and has to be asked for
  rather than derived. These scenarios drive the service itself. What the page
  then does with the answer is `bun run e2e:schema`, which needs a browser.

  Rule: The service says what is inside each version it answers

    @local
    Scenario: The document names the fields, and keeps the member older shells read
      Given a service that answers "v1"
      When the service is asked what it holds
      Then it still names "v1" among the versions it serves
      And it names "greeting.audience" as a field of "v1"
      And nothing in "v1" is going away

    @local
    Scenario: A version it does not answer is not described
      Given a service that answers "v1"
      When the service is asked what it holds
      Then it describes no version it does not answer

  Rule: A retirement is an operator's decision, and no code change

    @local
    Scenario: A retired field is named in the document, with the day it goes
      Given a service that answers "v1" and retires "greeting.audience" on "2026-12-10"
      When the service is asked what it holds
      Then it says "greeting.audience" goes on "2026-12-10"
      And it gives a reason for retiring "greeting.audience"
      And it still answers "greeting.audience"

    @local
    Scenario: A retirement naming a field the service does not answer stops it
      Given a service told to retire "greeting.audiance", which it does not answer
      Then it refuses to start, and names what it does answer

    @local
    Scenario: A retirement the service cannot parse stops it
      Given a service told to retire something that is not JSON
      Then it refuses to start, and says which part it could not read

  Rule: Every response carrying a retired field says so

    @local
    Scenario: The two headers, on the responses that carry the field
      Given a service that answers "v1" and retires "greeting.audience" on "2026-12-10"
      When a page reads the greeting from that service
      Then that response is marked deprecated and sunset on "2026-12-10"
      And it points at the document for the reason

    @local
    Scenario: A response is not marked while nothing is going away
      Given a service that answers "v1"
      When a page reads the greeting from that service
      Then that response is not marked deprecated

    @local
    Scenario: A page on another origin is allowed to read the two headers
      Given a service that answers "v1" and retires "greeting.audience" on "2026-12-10"
      When a page reads the greeting from that service
      Then another origin is permitted to read the sunset

  Rule: An operator changes what the service holds, and nothing is rebuilt

    The unit tests call the handler directly. These drive the running process,
    because what they are for is the state SURVIVING one request and being read
    by the next - which a handler called twice in one function cannot show.

    @local
    Scenario: A field written stays written for the next reader
      Given a service that answers "v1"
      When an operator sets "greeting" to {"audience": "Berlin"}
      And a page reads "greeting" from that service
      Then it reads back {"text": "Hello", "audience": "Berlin"}

    @local
    Scenario: A greeting a page could not draw is refused, and nothing changes
      Given a service that answers "v1"
      When an operator sets "greeting" to {"text": ""}
      Then the service refuses it, saying "text is not a non-empty string"
      And a page reads "greeting" from that service
      And it reads back {"text": "Hello", "audience": "world"}

    @local
    Scenario: An empty audience is a value, and not a refusal
      Given a service that answers "v1"
      When an operator sets "greeting" to {"audience": ""}
      And a page reads "greeting" from that service
      Then it reads back {"text": "Hello", "audience": ""}
