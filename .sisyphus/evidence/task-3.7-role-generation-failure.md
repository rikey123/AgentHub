# Task 3.7 Role Generation Job REST API — Failure Notes

- Initial polling test used an async helper incorrectly and timed out.
- Fixed the test to use explicit polling with a deadline, then the daemon suite passed.
