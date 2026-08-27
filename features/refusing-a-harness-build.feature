Feature: Refusing a build the test harness made
  As an operator
  I want promote to refuse a build that carries a test marker
  So that running the suites and then deploying cannot ship a scenario's
  build to visitors

  # dist/ is shared. e2e, verify:live and falsify each overwrite
  # dist/build.json with a throwaway build, so `promote <real channel>
  # --from-build` after any of them ships a harness build - and every other
  # check stays green, because the manifest written is well-formed and simply
  # describes the wrong units. That happened once, to prod.
  #
  # These are @local, which the conventions reserve for failures that cannot be
  # forced on the real store. This is one: forcing it means naming a real
  # channel, and if the refusal were ever removed the run itself would deploy to
  # visitors - the exact accident the refusal exists to prevent.
  #
  # No stand-in is involved. The steps run the real scripts/promote.ts, from a
  # working directory holding nothing but the dist/build.json under test, with
  # the store pointed at a host DNS cannot resolve. So "reached the store" and
  # "refused for a marker" are both positive readings, and removing the refusal
  # swaps one for the other.

  @local
  Scenario: A build the harness made is refused on a real channel
    Given a build the test harness made
    When the operator promotes it to the "qa" channel
    Then the promotion is refused because the build came from the harness
    And the store was never contacted

  # Without this the guard could be a blanket refusal of every marked build,
  # and the live suite - which promotes marked builds on purpose - would stop
  # working for a reason nothing here would explain.
  @local
  Scenario: The suite's own channels still accept a build the harness made
    Given a build the test harness made
    When the operator promotes it to the "test-qa" channel
    Then the promotion is not refused for carrying a marker
    And the store was contacted

  # And without this the guard could refuse everything, which would pass both
  # scenarios above and stop anyone deploying at all.
  @local
  Scenario: An ordinary build is not refused on a real channel
    Given a build made the ordinary way
    When the operator promotes it to the "qa" channel
    Then the promotion is not refused for carrying a marker
    And the store was contacted
