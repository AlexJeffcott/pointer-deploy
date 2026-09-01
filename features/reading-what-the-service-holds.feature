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
      And it names "user.colour" as a field of "v1"
      And nothing in "v1" is going away

    @local
    Scenario: A version it does not answer is not described
      Given a service that answers "v1"
      When the service is asked what it holds
      Then it describes no version it does not answer

  Rule: A retirement is an operator's decision, and no code change

    @local
    Scenario: A retired field is named in the document, with the day it goes
      Given a service that answers "v1" and retires "user.colour" on "2026-11-30"
      When the service is asked what it holds
      Then it says "user.colour" goes on "2026-11-30"
      And it gives a reason for retiring "user.colour"
      And it still answers "user.colour"

    @local
    Scenario: A retirement naming a field the service does not answer stops it
      Given a service told to retire "user.color", which it does not answer
      Then it refuses to start, and names what it does answer

    @local
    Scenario: A retirement the service cannot parse stops it
      Given a service told to retire something that is not JSON
      Then it refuses to start, and says which part it could not read

  Rule: Every response carrying a retired field says so

    @local
    Scenario: The two headers, on the responses that carry the field
      Given a service that answers "v1" and retires "user.colour" on "2026-11-30"
      When a page reads the user from that service
      Then that response is marked deprecated and sunset on "2026-11-30"
      And it points at the document for the reason

    @local
    Scenario: A response that does not carry the field is not marked
      Given a service that answers "v1" and retires "user.colour" on "2026-11-30"
      When a page reads the counters from that service
      Then that response is not marked deprecated

    @local
    Scenario: A page on another origin is allowed to read the two headers
      Given a service that answers "v1" and retires "user.colour" on "2026-11-30"
      When a page reads the user from that service
      Then another origin is permitted to read the sunset

  Rule: An operator changes what the service offers, and nothing is rebuilt

    The unit tests call the handler directly. These drive the running process,
    because what they are for is the state SURVIVING one request and being read
    by the next - which a handler called twice in one function cannot show.

    @local
    Scenario: A flag flipped stays flipped for the next reader
      Given a service that answers "v1"
      When an operator sets "flags" to {"showShares": false}
      And a page reads "flags" from that service
      Then it reads back {"showShares": false, "showTotals": true, "compact": false}

    @local
    Scenario: A limit a page could not draw is refused, and nothing changes
      Given a service that answers "v1"
      When an operator sets "limits" to {"step": 0}
      Then the service refuses it, saying "step is below 1"
      And a page reads "limits" from that service
      And it reads back {"step": 5, "max": 100, "allowNegative": true}

    @local
    Scenario: A message is put up, and taken down by naming null
      Given a service that answers "v1"
      When an operator sets "motd" to {"text": "back at 14:00", "level": "warn", "until": "2026-12-01"}
      And a page reads "motd" from that service
      Then it reads back {"text": "back at 14:00", "level": "warn", "until": "2026-12-01"}
      When an operator sets "motd" to null
      And a page reads "motd" from that service
      Then it reads back null

    @local
    Scenario: What the service counts is counted from what the service holds
      Given a service that answers "v1"
      When a page raises the "alpha" counter by 3
      And a page raises the "bravo" counter by 8
      And a page reads "stats" from that service
      Then what it read names 11 as the total and "bravo" as the busiest
