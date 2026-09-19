# Benchmark: 140 skills, 85 requests

Produced by `bun run bench` from the root of a project with 140 skills visible (67 project, 73 user). Requests live in `bench/requests.json`; the raw answers, including every probability, are in `bench/results.json`.

Label caveat: the 25 uncovered requests were written to punish guessing, and some of the "needless" suggestions below are defensible. Emailing the team about an outage arguably is internal-comms, and "why is my docker build slow" arguably is investigate. Counted strictly, as the table does, they are misses. The clear false positives are benchmark (a web-vitals skill) for "benchmark this tool", superset-browser for Mastodon (nearest neighbour when nothing fits, the same failure the cookbook reports), claude-api for "summarise this article", and superset-automate for a cron job.

Run on 2026-09-20 with model `jev-latest`, thresholds gate 0.3 / fits 0.3.

## Accuracy

| Metric | Result |
| --- | --- |
| Call 1 top-1 (gold skill ranked first out of 140) | 57/60 (95.0%) |
| Call 1 top-3 (gold skill reaches the shortlist) | 60/60 (100.0%) |
| Call 2 winner is the gold skill | 59/60 (98.3%) |
| Final suggestion correct (after both thresholds) | 57/60 (95.0%) |
| Final suggestion wrong skill | 1/60 (1.7%) |
| Final suggestion stayed quiet on a covered request | 2/60 (3.3%) |
| Needless suggestion on uncovered requests | 9/25 (36.0%) |

## Latency, tokens, cost

| | p50 | p95 | mean |
| --- | --- | --- | --- |
| Call 1 (140-way Choice + 3 gates) | 451 ms | 1383 ms | 590 ms |
| Call 2 (rerank top 3) | 346 ms | 560 ms | 372 ms |
| Both calls, sequential | 810 ms | 1784 ms | 961 ms |

Input tokens per prompt: 18065 on average, which is $0.00076 at $0.042/Mtok. One thousand prompts cost about $0.76. The whole run (85 prompts, 4 in parallel) took 20.8 s wall clock.

## Consistency (12 prompts, 3 runs each)

| Metric | Result |
| --- | --- |
| Same final suggestion across runs | 24/24 (100.0%) |
| Mean drift in gate score | 0.007 |
| Mean drift in top-1 probability | 0.001 |

## Threshold sweep (offline, same answers)

Rows are the gate threshold, columns the fits threshold. Each cell is correct / wrong / needless.

| gate \ fits | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.2 | 59 / 1 / 10 | 59 / 1 / 9 | 59 / 1 / 9 | 59 / 1 / 5 | 59 / 1 / 5 | 59 / 1 / 5 |
| 0.3 | 57 / 1 / 10 | 57 / 1 / 9 | 57 / 1 / 9 | 57 / 1 / 5 | 57 / 1 / 5 | 57 / 1 / 5 |
| 0.4 | 49 / 1 / 8 | 49 / 1 / 7 | 49 / 1 / 7 | 49 / 1 / 4 | 49 / 1 / 4 | 49 / 1 / 4 |
| 0.5 | 44 / 1 / 7 | 44 / 1 / 7 | 44 / 1 / 7 | 44 / 1 / 4 | 44 / 1 / 4 | 44 / 1 / 4 |

## Misses

| Request | Gold | Call 1 top | Final | Gate | Best fit |
| --- | --- | --- | --- | --- | --- |
| audit this existing page for AI slop design patterns and tel | hallmark | design-review (0.58) | design-review | 0.57 | 0.95 |
| design the settings screen in a clean editorial style, warm  | minimalist-ui | minimalist-ui (0.97) | quiet | 0.21 | 0.94 |
| I want the admin panel to feel like a raw military terminal  | industrial-brutalist-ui | industrial-brutalist-ui (1.00) | quiet | 0.25 | 0.95 |
| add a nice logo of this project | none | brandkit (0.85) | brandkit | 0.66 | 0.89 |
| test this tool in someway and bechmark this and show me some | none | benchmark (0.32) | benchmark | 0.78 | 0.82 |
| post this announcement to my mastodon account | none | superset-browser (0.21) | superset-browser | 0.83 | 0.47 |
| summarise this article in three bullet points | none | claude-api (0.72) | claude-api | 0.37 | 0.48 |
| why is my docker build so slow | none | investigate (0.77) | investigate | 0.32 | 0.74 |
| upgrade react from 18 to 19 in package.json and fix the brea | none | investigate (0.40) | verify-before-done | 0.83 | 0.40 |
| add a dark mode toggle to the navbar | none | ui-craft (0.73) | design-html | 0.61 | 0.75 |
| set up a cron job that backs up the postgres db nightly | none | superset-automate (0.85) | superset-automate | 0.65 | 0.42 |
| send an email to the team about the outage | none | internal-comms (1.00) | internal-comms | 0.74 | 0.84 |
