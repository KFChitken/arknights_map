# Incidents

Four incidents from the first month, each written up once it was over: what players saw, how the cause was found, what fixed it, and what changed so the same kind of problem is caught sooner. All times are UTC; Beijing time is UTC+8.

## 1. The site could not be opened from mainland China (2026-11-02 to 11-05)

**What players saw.** Friends in mainland China, the first people to try from there, could not open the site at all. Visitors in Hong Kong, Macau, Taiwan and abroad were fine.

**How the cause was found.** DNS gave the right address, the certificate was valid, and the page loads nothing that is blocked in mainland China (only Amap, with OpenFreeMap as a fallback). An online probe service then fetched the site from 319 places in mainland China. Every one failed, and plain TCP connections to port 443 failed too, while Hong Kong, Macau and Taiwan all worked. So the server's IP address itself could not be reached from the mainland; the domain and the code were not the problem. Since nobody had tried from the mainland before, the address was most likely blocked before it was assigned to this server.

**What fixed it.** On 11-05 the server was given a new public address in the cloud console, and both DNS records were pointed at it. Straight afterwards 316 probes in mainland China all loaded the site, in 3.0 seconds on average. Until the DNS records changed, the site could not be opened anywhere, so the two steps belong back to back.

**What changed.** Every morning at 09:00 Beijing time a GitHub Actions job (`.github/workflows/mainland-check.yml`) fetches the site through each server from probes in mainland China and Hong Kong, and fails, so GitHub sends an email, when most of them cannot.

## 2. Gmail slowed down sign-in codes (2026-11-10 to 11-14)

**What players saw.** From 17:55 on 11-10, sign-in codes sent to Gmail addresses arrived hours late or not at all. In the following hours only 20 to 60 percent of them got through each hour, in bursts. QQ, 163 and Outlook addresses were not affected. Gmail was about 4 percent of the site's mail.

**How the cause was found.** Gmail answered `421-4.7.28` ("unusual rate of mail") for the sending domain. The mail provider's support confirmed that Gmail was limiting the domain itself, not an IP address or the provider, because its volume had jumped: the site sent almost no mail before 11-09, when a video brought the first big wave of players, and about 57,000 sign-in emails in the day and a half after. SPF, DKIM and DMARC all passed. There is no quick way out of this: mail to Gmail has to drop back to a level that worked, then grow slowly.

**What fixed it.**

- From 22:28 the same evening, addresses at slow mail services (`MAIL_SLOW_DOMAINS`) got an allowance of their own, with daily, hourly and per-address limits, and a note that their code may be slow.
- At 05:57 on 11-11 codes to Gmail were paused, with a notice on the sign-in form, after mail the site itself had sent to Gmail was stuck for 8 to 10 hours. About three hours later Gmail accepted mail at once again.
- Password sign-in went live at 18:43 on 11-11, so players have a way in that needs no email. Since 11-12, signed-in Gmail players can set their first password without waiting for a code, and new Gmail sign-ups get at most 30 percent of the Gmail allowance, so existing players come first.
- At 00:23 on 11-14 codes to Gmail resumed under a low limit. The limit goes up one step only when new codes arrive within minutes, and down one step if they stall.

**What changed.** A new sending domain has to be warmed up, and one mail service can throttle while the others are fine. A slow mail service now has an allowance of its own, apart from the site-wide limit, so it can be slowed or paused alone, and signing in no longer depends on email alone.

## 3. Sign-in codes stuck behind map requests (2026-11-12)

**What players saw.** From 04:30 (12:30 in Beijing) many players said their sign-in codes did not arrive. Normally about 91 percent of codes are used, a median of 20 to 26 seconds after they are sent. Now only about half were used, after a median of 82 to 144 seconds. Password sign-in kept working.

**How the cause was found.** Nothing about mail had changed. Neither the site's daily limit nor the provider's quota was stopping mail, sending had almost no failures, and every mail service dropped in the same ten minutes, which pointed at the site rather than at a provider. The drop began the minute a release went out. That release sent the zoomed-out map to signed-in players in tiles: about 30 requests each time a player zoomed out, repeated every 5 minutes. The app processes ran at 140 percent CPU, and a request inside the server took 11 to 23 seconds. A code request waits until its email is handed to the provider, and each process sends mail over a small pool of connections, so the mail queued behind map requests. Codes expire after 10 minutes, and resends made the queue longer. Password sign-in needs a single round trip, so it still worked.

**What fixed it.** The owner decided to roll back at 05:31, and the release was rolled back at 05:36. From 05:40 codes were used again within about 20 seconds, and requests inside the server went from 20 seconds back to 0.1 to 0.2 seconds, which confirmed the cause. The same day the tiles were replaced by a single overview of the whole map, which pages download again only every half hour.

**What changed.** For ten minutes after every release, the share of sign-in codes being used is counted along with errors and response times, because this problem left nothing in the error logs. A release that hurts is rolled back first and investigated after.

## 4. A black page on Tencent's map (2026-11-15)

**What players saw.** At 05:55 the owner passed on reports from many players in mainland China: the page went black after a tutorial card, and stayed black every time they opened it again.

**Background.** Mainland visitors see Amap or, as a backup, Tencent's map. Since 22:26 Beijing time the evening before they had been on Tencent's map, because Amap's daily allowance had run out and the switch was mistakenly kept for the rest of the month rather than the rest of the day.

**How the cause was found.** A player's screen recording made it reproducible locally at 07:40. One step of the tutorial glides the map to a guide character standing in Rhode Island, USA. The glide aimed at a halfway point computed as the average of the two longitudes, but Tencent's map hands back the far end on the nearest copy of the world (-71.26° comes back as 288.74°), so from China the halfway point came out at 205.1°. Tencent's map throws an error for a longitude outside -180° to 180°. It was thrown inside a React effect, so the whole page went down, and the default error text is dark on a dark background. The tutorial remembers its step in the browser, so every reload ran the same glide again.

**What fixed it.**

- 07:46: mainland visitors moved to Amap, which never took this path. A readable error page, a card in place of a map that cannot load, and a map view that survives the browser losing its WebGL context (a separate crash found on the way).
- By 08:59: every longitude handed to Tencent's map is wrapped into range (`src/lib/coords.ts`), and a move the map refuses becomes a jump instead of an error.
- Later that day: pages report their own crashes to the server, with a sentence about it in the privacy notice, and the Amap switch lasts one Beijing day, not a month.

**What changed.** A crash in the browser never reached the server, so this one was known only from players. Page crash reports now feed the same checks and alerts as server errors. Anything handed to Tencent's map must stay within -180° to 180°, while MapLibre allows longitudes past 180°.

See [scaling.md](scaling.md) for how the site grew, and [decisions.md](decisions.md) for the product decisions behind it.
