Feature: Pointing every region at one composition
  As an operator
  I want one promote to move every region
  So that a machine in another region cannot go on serving what it served before

  # Only the pointer and the history are per region. A unit's files are one set
  # of objects in one bucket, reached by an absolute URL, so a second region
  # needs no copy of anything a build produced - which is why this costs one
  # more pointer write and nothing else.
  #
  # @live and never @local: the stub store models one region, and what these
  # scenarios are about is the real script writing the second key.

  Background:
    Given build "alpha" is published
    And build "beta" is published

  # The byte comparison is the load-bearing half. Two regions naming the same
  # build prove nothing on their own - they match just as well when one of them
  # was already there from an earlier run, which is exactly how this scenario
  # first passed against a promote that wrote one region. `composedAt` moves on
  # every promote, so identical documents mean one promote wrote both.
  @live
  Scenario: One promote points every region at the same composition
    When the operator promotes build "alpha" to the qa channel
    Then every region's pointer names build "alpha" on the qa channel
    And every region holds the composition this promote wrote on the qa channel

  # The state a promote must not flatten. The merge that makes "deploy alpha,
  # leave bravo alone" possible reads ONE region, so writing both would replace
  # the other with a composition nobody chose for it.
  @live
  Scenario: A promote refuses to flatten a difference between the regions
    Given the qa channel points at build "alpha"
    And the "us" region alone is moved to build "beta" on the qa channel
    When the operator promotes build "alpha" to the qa channel
    Then the promotion is refused because the regions disagree
    And the "us" region's pointer names build "beta" on the qa channel

  # The way out the refusal names, and the reason a region can be moved at all.
  @live
  Scenario: Naming one region writes that region and no other
    Given the qa channel points at build "alpha"
    When the "us" region alone is moved to build "beta" on the qa channel
    Then the "us" region's pointer names build "beta" on the qa channel
    And the "eu" region's pointer names build "alpha" on the qa channel

  # The machine, not the pointer. Both regions hold the same composition, so
  # nothing on the page can tell one machine from the other - what separates
  # them is which manifest each READ, and `/compositions` is where a process
  # records that against every shell it handed out.
  #
  # `fly scale count 1 --region iad` on 2026-08-30 created the second machine.
  # Without one there, Fly routes the request to the machine that exists and
  # this scenario fails rather than passing quietly.
  @live
  Scenario: Each region's machine reads its own region's manifest
    When a visitor loads the qa origin through the "ams" region
    Then that machine says it served the "eu" region
    When a visitor loads the qa origin through the "iad" region
    Then that machine says it served the "us" region
