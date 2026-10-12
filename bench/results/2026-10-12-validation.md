# Validation after the full benchmark · 2026-10-12 · https://staging.software.turbineh.com

The full benchmark ([2026-10-12-18-47-benchmark.md](2026-10-12-18-47-benchmark.md)) ran with the code merged before
PRs #45–#53. These builds validate those changes on staging (same verification gate, one build each).

| Build | What it validates | Green | Checks | Criteria verified | Corrections | T3 rule kept | Cost € (tracked + overhead) [est.] |
|---|---|---|---|---|---|---|---|
| saas-04 | Entity colliding with a native component table (#49), the only red build of the benchmark | ✅ | 11/11 | 4/7 | 3 | — | 0.02354 |
| shop-05 | Coupons, EUR + USD, Stripe Checkout in the chosen currency (#45) | ✅ | 11/11 | 6/8 | 3 (glue `data.countries`) | — | 0.01805 |
| gym-edit | T3 rule on edits: "end date never before the start date" (#48) | ✅ | 11/11 | 5/5 | 0 | ✅ memberships | 0.01352 |
| academy-cross | T3 rule across entities: "course only for an existing teacher, max 3 per teacher" (#48) | ✅ | 11/11 | 3/5 | 0 | ✅ courses | 0.01319 |

Load test on production with two workers (Scaleway + AWS): [2026-10-12-19-09-load.json](2026-10-12-19-09-load.json)
— 10/10 green, 430 s wall clock, 83.7 builds/hour, max queue 7.

Notes:

- A first load-test run was discarded: the new AWS worker lacked the sandbox image and failed its builds at `install`
  (fixed in #51; it was stopped within minutes and only test builds were affected).
- Two validation builds were interrupted by a worker crash (Semgrep under load, fixed in #52) and by a deploy restart;
  they were re-run.
