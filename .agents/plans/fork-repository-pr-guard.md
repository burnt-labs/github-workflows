# Fork Repository PR Guard

1. Match pull-request heads against the caller repository identity instead of its global fork flag.
2. Keep external fork pull requests excluded from credential-bearing preview jobs.
3. Add a regression test, run the full shared-workflow check, publish a signed fix, and release it for consumers.
