# Benchmark: 140 skills, 85 requests

Produced by `bun run bench` from the root of a project with 140 skills visible (67 project, 73 user). Requests live in `bench/requests.json`; the raw answers, including every probability, are in `bench/results.json`.

Label caveat: the 25 uncovered requests were written to punish guessing, and some of the "needless" suggestions below are defensible. Emailing the team about an outage arguably is internal-comms, "why is my docker build slow" arguably is investigate, and "add a dark mode toggle" arguably is ui-craft. Counted strictly, as the table does, they are misses. The clear false positives are benchmark (a web-vitals skill) for "benchmark this tool" and claude-api for "summarise this article".

Roster caveat: two of the wrong picks are between skills that overlap almost completely (hallmark, design-taste-frontend and design-review all audit or build anti-slop pages). Call 2 splits those on a coin flip, and the flip changes between runs. Deduplicating skills like that on your own roster does more than any threshold.

Default change: the shipped `fitsThreshold` moved from 0.30 to 0.50 after the first run, which cut needless suggestions from 9 to 6 without losing a correct pick to the threshold.

Run on 2026-09-20 with model `jev-latest`, thresholds gate 0.3 / fits 0.5.

## How to read the metrics

The 85 requests split into two groups.

**Covered (60).** Each has a label naming the one skill that should fire, for
example "free up some disk space on my mac" is labeled clean-space. Every
covered request lands in exactly one of three buckets: correct (skillpick
suggested the labeled skill), wrong (it suggested a different skill), or quiet
(it suggested nothing). Wrong is the costliest bucket, because a confident bad
hint can push the agent off a path it would have found alone. Quiet costs
less, since the agent still has its full skill list.

**Uncovered (25).** Written so that no installed skill applies: everyday
requests, general coding with no special procedure, and tasks the roster has
no skill for, such as posting to Mastodon when only an X skill exists. The
right answer is "no installed skill appears relevant". A needless suggestion is
any skill suggested for one of these. It happens because the first call is a
pick-one question, so something always ranks first, and only the gate
questions and the second-call fit check stand between that nearest neighbour
and the suggestion. On a normal day most prompts are uncovered, so this is
the number to watch.

**Consistency** re-runs 12 covered requests three times and checks whether the
final suggestion and the underlying probabilities stay the same.

**Latency** is measured from the hook's point of view: p50 is the median, p95
means one prompt in twenty is slower than this.

## Accuracy

| Metric | Result |
| --- | --- |
| Call 1 top-1 (gold skill ranked first out of 140) | 58/60 (96.7%) |
| Call 1 top-3 (gold skill reaches the shortlist) | 60/60 (100.0%) |
| Call 2 winner is the gold skill | 58/60 (96.7%) |
| Final suggestion correct (after both thresholds) | 56/60 (93.3%) |
| Final suggestion wrong skill | 2/60 (3.3%) |
| Final suggestion stayed quiet on a covered request | 2/60 (3.3%) |
| Needless suggestion on uncovered requests | 6/25 (24.0%) |

## Latency, tokens, cost

| | p50 | p95 | mean |
| --- | --- | --- | --- |
| Call 1 (140-way Choice + 3 gates) | 442 ms | 1491 ms | 520 ms |
| Call 2 (rerank top 3) | 344 ms | 445 ms | 361 ms |
| Both calls, sequential | 805 ms | 1812 ms | 880 ms |

Input tokens per prompt: 18072 on average, which is $0.00076 at $0.042/Mtok. One thousand prompts cost about $0.76. The whole run (85 prompts, 4 in parallel) took 19.0 s wall clock.

## Consistency (12 prompts, 3 runs each)

| Metric | Result |
| --- | --- |
| Same final suggestion across runs | 24/24 (100.0%) |
| Mean drift in gate score | 0.007 |
| Mean drift in top-1 probability | 0.007 |

## Threshold sweep (offline, same answers)

Rows are the gate threshold, columns the fits threshold. Each cell is correct / wrong / needless.

| gate \ fits | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.2 | 58 / 2 / 11 | 58 / 2 / 10 | 58 / 2 / 8 | 58 / 2 / 6 | 58 / 2 / 5 | 58 / 2 / 5 |
| 0.3 | 56 / 2 / 11 | 56 / 2 / 10 | 56 / 2 / 8 | 56 / 2 / 6 | 56 / 2 / 5 | 56 / 2 / 5 |
| 0.4 | 49 / 1 / 9 | 49 / 1 / 8 | 49 / 1 / 6 | 49 / 1 / 4 | 49 / 1 / 4 | 49 / 1 / 4 |
| 0.5 | 43 / 1 / 9 | 43 / 1 / 8 | 43 / 1 / 6 | 43 / 1 / 4 | 43 / 1 / 4 | 43 / 1 / 4 |

## Misses

| Request | Gold | Call 1 top | Final | Gate | Best fit |
| --- | --- | --- | --- | --- | --- |
| make a landing page for my startup with a bold distinctive v | design-taste-frontend | design-taste-frontend (0.43) | hallmark | 0.39 | 0.93 |
| audit this existing page for AI slop design patterns and tel | hallmark | design-review (0.52) | design-review | 0.57 | 0.95 |
| design the settings screen in a clean editorial style, warm  | minimalist-ui | minimalist-ui (0.97) | quiet | 0.21 | 0.94 |
| I want the admin panel to feel like a raw military terminal  | industrial-brutalist-ui | industrial-brutalist-ui (1.00) | quiet | 0.26 | 0.95 |
| add a nice logo of this project | none | brandkit (0.87) | brandkit | 0.66 | 0.87 |
| test this tool in someway and bechmark this and show me some | none | skill-creator (0.37) | benchmark | 0.78 | 0.81 |
| summarise this article in three bullet points | none | claude-api (0.75) | claude-api | 0.37 | 0.55 |
| why is my docker build so slow | none | investigate (0.80) | investigate | 0.33 | 0.74 |
| add a dark mode toggle to the navbar | none | ui-craft (0.72) | design-html | 0.60 | 0.76 |
| send an email to the team about the outage | none | internal-comms (1.00) | internal-comms | 0.73 | 0.83 |
