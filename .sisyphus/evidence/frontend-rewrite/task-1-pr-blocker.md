# PR Blocker — frontend-rewrite

## Blocker
No git remote is configured in this repository.

## Evidence
- `git remote -v` returned no output.
- `gh auth status` succeeded and shows the GitHub CLI is authenticated.

## Impact
PR creation, branch push, and PR gate steps cannot proceed until a remote is added.

## Required User Action
Configure a git remote for this repository, then rerun the PR gate steps.
