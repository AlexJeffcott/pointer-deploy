Feature: Selecting the channel from the request origin
  As an operator
  I want each origin to select its own channel
  So that one server image serves every environment and a deploy needs no new image

  Background:
    Given the qa channel points at build "alpha"

  # These two together are the discriminating pair. Either alone passes on a
  # server that serves one build to everything.
  @live @needs-domain
  Scenario: The qa origin serves the build the qa channel points at
    Given the prod channel points at build "beta"
    When a visitor loads the qa origin
    Then the shell identifies build "alpha"

  @live @needs-domain
  Scenario: The prod origin serves a different build from the same server
    Given the prod channel points at build "beta"
    When a visitor loads the prod origin
    Then the shell identifies build "beta"
    And both origins are served by the same application

  # Host parsing is the only thing separating the environments, so an
  # unrecognised host must be refused rather than defaulted.
  @live @local
  Scenario: An unrecognised origin is refused rather than defaulted
    When a visitor loads an origin that is not configured
    Then the request is refused as not found
    And no build is identified in the response
