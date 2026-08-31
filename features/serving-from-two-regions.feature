Feature: Pointing every region at one composition
  As an operator
  I want one promote to move every region
  So that a machine in another region cannot go on serving what it served before

  Background:
    Given build "alpha" is published
    And build "beta" is published

  @live
  Scenario: One promote points every region at the same composition
    When the operator promotes build "alpha" to the qa channel
    Then every region's pointer names build "alpha" on the qa channel
    And every region holds the composition this promote wrote on the qa channel

  @live
  Scenario: A promote refuses to flatten a difference between the regions
    Given the qa channel points at build "alpha"
    And the "us" region alone is moved to build "beta" on the qa channel
    When the operator promotes build "alpha" to the qa channel
    Then the promotion is refused because the regions disagree
    And the "us" region's pointer names build "beta" on the qa channel

  @live
  Scenario: Naming one region writes that region and no other
    Given the qa channel points at build "alpha"
    When the "us" region alone is moved to build "beta" on the qa channel
    Then the "us" region's pointer names build "beta" on the qa channel
    And the "eu" region's pointer names build "alpha" on the qa channel

  @live
  Scenario: Each region's machine reads its own region's manifest
    When a visitor loads the qa origin through the "ams" region
    Then that machine says it served the "eu" region
    When a visitor loads the qa origin through the "iad" region
    Then that machine says it served the "us" region
