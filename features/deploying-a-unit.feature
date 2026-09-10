Feature: Deploying and rolling back one unit at a time
  As an operator
  I want to deploy a change to one unit without moving the others
  So that shipping one part of the page, and undoing it, does not drag
  unrelated bundles with it

  Six scenarios are missing from this file and they are not gaps. Every one of
  them was a sentence about two units — the frame stays where it was while a
  sub-app moves, a rollback of one leaves the other, a publish uploads one of
  them, a composition is refused because two units share no contract, a sub-app
  needs a member the shell does not have. `PLAN.md` step 0 takes the tree to one
  unit, so each of those has nothing to hold still. They come back at step 1
  against `list`, and TODO §31 records the loss rather than this file implying
  it was never claimed.

  Background:
    Given build "one" is published and promoted to the qa channel

  @live
  Scenario: Promoting an unpublished unit is refused
    When the operator promotes a "shell" unit that was never published
    Then the promotion is refused because that unit is not published
    And the qa channel still serves build "one" for every unit
