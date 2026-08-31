Feature: Reading the page's values from a service on its own schedule
  As an operator
  I want the page to be told where the service is and whether it can use it
  So that a fourth deploy schedule is a thing I can read rather than guess at

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
      Given a visitor opens the counters view
      Then the page is allowed to fetch from that service
      But it is not allowed to fetch from the store
