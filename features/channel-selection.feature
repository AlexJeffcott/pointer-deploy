Feature: Selecting the channel from the request origin
  As an operator
  I want each origin to select its own channel
  So that one server image serves every environment and a deploy needs no new image

  Background:
    Given the qa channel points at build "alpha"

  @live
  Scenario: The qa origin serves the build the qa channel points at
    Given the prod channel points at build "beta"
    When a visitor loads the qa origin
    Then the shell identifies build "alpha"

  @live
  Scenario: The prod origin serves a different build from the same server
    Given the prod channel points at build "beta"
    When a visitor loads the prod origin
    Then the shell identifies build "beta"
    And both origins are served by one machine

  @live @local
  Scenario: An unrecognised origin is refused rather than defaulted
    When a visitor loads an origin that is not configured
    Then the request is refused as not found
    And no build is identified in the response
