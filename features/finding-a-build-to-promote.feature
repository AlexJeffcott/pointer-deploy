Feature: Finding a build worth promoting
  As an operator naming a unit id in a promote
  I want one record of every unit that has been published
  So that choosing a build is reading rather than remembering

  @live
  Scenario: Publishing a unit records it where a promote can find it
    Given an unpublished "alpha" unit is published
    Then the catalogue names that "alpha" unit

  @live
  Scenario: A unit no channel has ever pointed at is in the catalogue all the same
    Given build "one" is published and promoted to the qa channel
    And an unpublished "alpha" unit is published
    Then the qa channel's history does not name that "alpha" unit
    But the catalogue names that "alpha" unit

  @live
  Scenario: The catalogue is derived, so a lost write costs nothing but a rebuild
    Given build "one" is published and promoted to the qa channel
    When the catalogue is deleted from the store
    And the catalogue is rebuilt
    Then the catalogue names every unit of build "one"

  @live
  Scenario: A rebuild re-reads only the units whose record moved
    Given build "one" is published and promoted to the qa channel
    When the catalogue is rebuilt
    Then it re-read none of the published units
