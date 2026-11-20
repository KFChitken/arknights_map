# From 300 to 100,000 players in three days

Arkmap went live on 2026-10-22 on one small server. On 2026-11-09 a video introduced it to the community. The number of registered players went from about 300 that evening to about 20,000 the next day, and past 100,000 on 2026-11-12.

This page lists the bottlenecks in the order they appeared, how each one was found, and what removed it. The rule throughout was to measure first, make the smallest change that removes the bottleneck, and spend money only where code could not help.

| When | Bottleneck | How it was found | What changed | Result |
|---|---|---|---|---|
| Before launch | The roach list was rebuilt for every request. With 10,000 test players, 150 people at once were fine, 300 were slow and 500 brought the site down | Load test on a copy of the site | One shared list in memory; browsers get only what changed since their last copy | 2,000 requests, 95% answered within 9 ms |
| 11-09 to 11-10 | Dragging the Amap basemap with over 10,000 roaches ran at about 11 frames a second | Frame timing, with the browser's CPU slowed down four times | Roaches drawn by our own GPU layer instead of Amap's markers | 60 frames a second in the same test |
| 11-10 | About 20,000 players. The 2-core server was overloaded; after an upgrade to 4 cores, declaration notifications filled all four in the afternoon | Server load and CPU per process | 4 cores and 8 GB; the app split into three processes; notifications fetch only new items and are batched within 60 seconds | Recovered the same day |
| 11-10 evening | Outgoing bandwidth held flat at about 45 Mbps, then about 15 Mbps, far below the 200 Mbps peak | Five-minute monitoring data showed a flat top rather than a full pipe; the cloud provider confirmed that a shared pool is throttled at busy times | A second server as a second way in, relaying to the first over the private network | At the next evening peak neither server was throttled, and 1 of 96 probes from mainland China failed |
| 11-11 | Load average 18, database CPU above 95% | Per-query statistics in PostgreSQL | The two most expensive queries fixed (a lock queue around sign-in code mail, a missing index); two app processes moved to the second server | Load average from 12 to 4; free memory from 1.2 GB to 4 GB |
| 11-11 | Every new page downloaded the whole world's roaches, about 1.2 MB at 150,000 roaches | Response sizes | Visitors who are not signed in get totals only; signed-in players get the roaches near their view | Far less outgoing traffic, and better privacy |
| 11-11 | Each declaration wrote one row per player within 10 km: about 0.7 GB a day, heading for 10 GB a day at 100,000 players | Table growth | Each declaration stored once and looked up by area | Storage no longer grows with the audience |
| 11-11 to 11-12 | What breaks next? | Load test with 200,000 made-up players and about 400,000 roaches | Found the next limits (rebuilding the list blocks the process; the database wants 5 to 6 cores), then rebuilt the list incrementally and cached the radar per grid cell for 5 minutes | A plan for 200,000 players, with a third server bought only when the numbers call for it |

The frame rates were measured under a fourfold CPU slowdown in the browser, so they compare the two versions rather than describe any one phone.

## What made it work

- **One change at a time.** Each fix shipped on its own and was watched for ten minutes, so a regression pointed at one change.
- **Numbers before money.** The bandwidth cap looked like a full pipe until the monitoring data showed a flat top. A second server as a second way in cost less than a premium bandwidth package and also added cores.
- **Privacy and performance together.** Sending visitors totals instead of every roach cut traffic and removed the last way to see exact positions without signing in.

See [incidents.md](incidents.md) for what went wrong along the way.
