Feature: Publishing a build
  As an operator
  I want a published build to be immutable and permanent
  So that a page loaded before a deploy can still fetch the files it needs

  @live
  Scenario: A build's files may be cached indefinitely
    Given build "alpha" is published
    When a visitor fetches a file of build "alpha"
    Then the file is marked as safe to cache indefinitely

  @live
  Scenario: An earlier build's files remain available after a newer build is promoted
    Given build "alpha" is published
    And build "beta" is published and promoted to the qa channel
    When a page loaded from build "alpha" requests one of its files
    Then the file is served

  @live
  Scenario: A browser is allowed to load a build's script from the store
    Given build "alpha" is published
    When a browser on the qa origin requests the script of build "alpha"
    Then the store permits that origin to use it

  @live
  Scenario: Every file a promoted build names is fetchable
    Given build "alpha" is published and promoted to the qa channel
    Then every file that build names can be fetched

  @live
  Scenario: Republishing a build that has not changed uploads nothing
    Given build "alpha" is published
    When the operator publishes build "alpha" again
    Then no unit is uploaded, because none of them changed

  @live
  Scenario: A channel cannot point at a build whose upload did not finish
    Given a publish of build "delta" is interrupted after some files are uploaded
    When the operator promotes build "delta" to the qa channel
    Then the promotion is refused because build "delta" has no manifest
