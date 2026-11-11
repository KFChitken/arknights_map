# Roach Map

A friend-finding map for **Arknights** and **Arknights: Endfield** players.

Players in the community jokingly call themselves "roaches" because there seem to be so many of them, yet most never meet another player offline. Roach Map gives every player a small cartoon roach that sits on a world map, so you can see how many players are around you and make friends nearby.

> Unofficial fan project. Not affiliated with or endorsed by Hypergryph. Non-commercial.

## Features

| Feature | Status |
|---|---|
| World map with two basemaps behind one URL: visitors from mainland China (told from their address against APNIC's list in `src/data/cn-ip-ranges.json`, refreshed with `node scripts/fetch-cn-ranges.mjs`; the address is never stored) get Amap wherever China is in view and our own OpenStreetMap map abroad (`src/lib/chinaView.ts`), everyone else MapLibre + OpenStreetMap with a switch to Amap | MVP |
| Swarm view: every roach is drawn and twitches, and a dark heat layer makes crowded cities look covered in roaches; cartoon or realistic roaches | Prototype |
| Place a main roach and up to five clones by tapping the map or searching for a place (from mainland China: Tencent Location Service suggestions while typing, and through our server (`/api/geo`) OpenStreetMap plus a daily share of Amap's searches; elsewhere OpenStreetMap's Photon and Nominatim, asked by the browser) | MVP |
| Profile: a name (checked against the rules in `src/lib/nameRules.ts` and a word list kept on the admin page) with an optional "Dr." prefix or stay anonymous, games played, up to three favourite characters per game, an optional game UID, and one of four cartoon roach looks (the hood is drawn in code with a color option; the other three are original artwork in `public/avatars`) | MVP |
| Antenna touches: touch another roach sneakily (they only learn they were touched) or boldly (they can see your profile); they are told at once if the page is open (a server-sent event stream), otherwise on their next visit, and can touch back. One player touches another's roaches at most three times a day, touching back included, and nobody touches back someone they touched that day | MVP |
| Antenna friends: two players who have touched each other boldly become friends, and can see each other's roaches, declaration count and recent activity; either side can end it | MVP |
| Declarations: one of nine canned shouts such as "Arknights, start!", "I'll always love &lt;favourite&gt;" or "Happy birthday to me", sent to every player with a roach within 10 km of the main roach, any chosen clones, or all of them; each player hears it once and can answer with one of six fixed reactions | MVP |
| Email sign-in with a 6-digit code; sign-up is for players aged 18 and over, who tick that they are (no birth date is asked for) and give the storage-and-mail consent on its own; account deletion | MVP |
| 摄入酒精: a player's main roach gets drunk and lies belly up on everyone's map until 8:00 where it lies (or until they sober up or move it); the feed only says it is asleep, never why; 50 drinks earn a badge | MVP |
| Demo players and test identities: thousands of seeded players, and stepping into any of them on one device to try touches and declarations | Development aid |
| Block and report: reporting also blocks; when three different reliable players (accounts three days old whose reports are not often found wrong) report what someone wrote about themselves (the name, contact details, passing for someone else), that player's name and UIDs are hidden and locked until the admin looks, and a new account two of them report for spam is paused. A roach on the map can be reported for where it was put (always beside the reporter's, at a school or a door, several spelling something out): that blocks nobody, and the admin sees only that roach's spot, a case of its own apart from its owner's. The admin works through one queue, the most pressing first, fifty a page, and can let a profile out, clear the name or the UIDs for good on that account, warn (a yellow card), pause interactions for a week, ask for the age again, take a roach back (also a yellow card), or ban the mailbox however it is written, keeping why; both sides hear the outcome from 「站长」 in their messages, never who reported, and the player can appeal once within 30 days, which the admin keeps or undoes. Accounts are found by a search, and any address can be checked for a ban | MVP |
| Follow requests that need approval | Planned |
| Ark Radar: how many roaches are within 100 km of your main roach, how many crawled in or left in the last day and week, newcomers, nearby touches and declarations | MVP (demo movement for the demo players) |
| Your roach's travel trail | Planned |

## Privacy by design

Location sharing combined with a social feature is a stalking risk, so the privacy rules come before features:

- **No GPS.** Players place their roach by hand. Nothing reads the device location.
- **Roaches show where they were placed, never who placed them.** Players are asked not to place a roach at home or anywhere else that identifies them, and before their first roach they agree on a card of its own that everyone, visitors included, sees its exact spot.
- **Bigger privacy policy changes are agreed to again.** Accounts that agreed to an older version see the changes first and can do nothing others see until they agree (or sign out).
- **Anonymous by default.** Strangers only see an anonymous roach. A bold touch shows the toucher's profile to the player they touched; a sneaky touch shows nothing. Game UIDs stay hidden unless their owner chooses to show them to the players they touch boldly.
- **Touches and declarations never carry a position.** A declaration reaches everyone with a roach within 10 km of the roaches the sender picked; recipients only learn "within 10 km", and the sender only gets a rough head count ("5–10 players"). Reactions reach the sender without saying who reacted. The one sentence that names its sender ("I'm &lt;name&gt;, I want to play …") says so before it is sent.
- **Friendship is opt-in on both sides.** Only two bold touches, one each way, make players friends; sneaky touches never count. Friends can tell which roaches belong to each other; other players in a friend's activity stay anonymous.
- **Clones cannot be traced back.** Every clone looks the same, gets a new public id whenever it moves, and is listed in random order, so nobody but the owner's friends can tell which main roach it belongs to. Touching a clone reaches its owner without revealing anything about them.
- **Activity does not pile up.** Touches, declarations, reactions and roach moves are deleted after 90 days, and nightly database backups are kept for 14.
- **Blocking hides you completely** from the blocked player's map and radar.
- **The radar shows counts, never distances or directions.** It counts over a 100 km circle from the same positions everyone sees on the map, so it reveals nothing the map does not.

## Tech stack

- Next.js (App Router) + TypeScript, frontend and API in one project
- Amap JS API 2.0 for mainland China, MapLibre GL JS + OpenFreeMap tiles elsewhere, and for mainland visitors abroad a [Protomaps](https://protomaps.com) build of OpenStreetMap served from our own server
- Amap shifts coordinates in mainland China, Hong Kong, Macau and Taiwan only (`src/lib/coords.ts`); the outlines behind that and behind where Amap must show come from Natural Earth (`node scripts/build-china-areas.mjs <folder>`)
- Coordinates stored as WGS-84 and converted to GCJ-02 for Amap with `gcoord`
- PostgreSQL + PostGIS with Drizzle; the rules live in `src/lib/server/world.ts`, and the browser reaches them through the data-layer interface in `src/lib/world`
- Email via SMTP: Mailpit locally, any SMTP provider (e.g. Resend) in production
- Deployed with Docker Compose on a Hong Kong VPS behind Caddy, which handles HTTPS
- Character names come from the BWIKI operator lists (names only)

## Run locally

You need an Amap **Web (JS API)** key and its security code for the China basemap. Without them the app falls back to the OpenStreetMap basemap.

```bash
cp .env.example .env    # fill in the Amap key and security code, and a random secret
```

Start the database and the test mail inbox, then the app:

```bash
docker compose up -d db mail
npm install
npm run dev
```

Open http://localhost:3000. Sign-in codes land in the test inbox at http://localhost:8025. To try it on a phone, connect the phone to the same Wi-Fi and open `http://<your computer's IP>:3000` (the inbox is at port 8025 on the same address).

The database schema is migrated and, in development, filled with demo players when the server starts. `DEMO=0` turns the demo players and test identities off; production leaves them off unless `DEMO=1`. After changing `src/lib/server/schema.ts`, run `npm run db:generate` to write a new migration.

The 👤 button at the top (development only) switches between test identities: yourself, a few test players (the Shanghai ones are within 10 km of each other) and any passer-by somebody touched. Switching signs you in as that player, so touches, the next-visit notice, declarations and friends can all be tried on one device.

To run everything in Docker instead (the app also needs port 3000, so stop `npm run dev` first):

```bash
docker compose up --build
```

To add another picture look, cut the character out of its white background and shrink it with:

```bash
node scripts/cutout.mjs <original.png> public/avatars/<name>.png 256
```

Check the code the same way GitHub does on every push (`.github/workflows/check.yml`). The tests run the server's rules against a separate `roach_test` database, so the database container must be up:

```bash
docker compose up -d db
npm run typecheck
npm run lint
npm test
```

Append `?style=blank` to the URL to replace the OSM basemap with a plain background when the tile server is unreachable.

## Deploy

The live stack is `docker-compose.prod.yml`: Caddy (`deploy/Caddyfile`) is the only service with open ports and gets HTTPS certificates by itself; the app and Postgres stay on the internal network. Login rate limits trust only the address Caddy appends to `X-Forwarded-For`, so the app port must never be published on the server.

First time, with an SSH host entry named `zhoupmap` for the server:

```bash
ssh zhoupmap 'bash -s' < scripts/server-setup.sh
```

That installs Docker, adds swap for builds, clones the repository and writes a `.env` with fresh secrets. Fill in the Amap key and the SMTP settings of the mail service there. Set `ADMIN_EMAILS` to the sign-in email of whoever handles reports: that account can open `/admin`, sees how many reports wait in a corner of the map, reads the day's new reports in the morning digest (see Checks and alerts), and gets an email within the hour for a report of a minor, of contact details, or of a roach put beside someone's or somewhere it should not be (report emails are not counted against `MAIL_DAILY_LIMIT`). `MAIL_DAILY_LIMIT` caps the sign-in code emails in any 24 hours, and `MAIL_SLOW_DOMAINS` (say `gmail.com,googlemail.com`) tells addresses at a mail service slow to take the site's mail, once their code is sent, that it may take long and that QQ or 163 is quicker for a new account; empty says nothing. After that, every update is a push to `main` followed by:

```bash
scripts/deploy.sh
```

GitHub builds the app image for every push to `main` (`.github/workflows/image.yml`, which needs the `AMAP_KEY` and `AMAP_SECURITY_CODE` repository secrets, and builds in the Tencent Location Service key from an optional `TENCENT_KEY` secret) and publishes it as `ghcr.io/kfchitken/arknights_map`. The deploy script waits for that build, then the server pulls `main`, downloads the image and restarts; if the build failed or the image cannot be downloaded, the server builds it itself. Images never contain `.env`: the server's secrets are read when the container starts. Database migrations run when the app starts.

Our own overseas map lives in `~/arknights_map/tiles` on the server, outside git, and Caddy serves it at `/tiles`. The map file is a cut of one Protomaps build down to zoom 12 (about 18 GB), fetched by the server itself with [go-pmtiles](https://github.com/protomaps/go-pmtiles):

```bash
pmtiles extract https://build.protomaps.com/20261105.pmtiles ~/arknights_map/tiles/world-20261105.pmtiles --maxzoom=12 --download-threads=4
```

A newer build goes in under its own date, with `OVERSEAS_TILES` in `src/lib/overseas.ts` changed to match. The fonts (Noto Sans Regular, Medium and Italic) and the `light` icons of `sprites/v4` come from [basemaps-assets](https://github.com/protomaps/basemaps-assets) into `tiles/fonts` and `tiles/sprites` on the Mac, and each deploy copies them over. For local development put a small cut (`--bbox=...`) under the same name in `tiles/`, and open `localhost:3000/?mainland=1` to see the site as a visitor from mainland China would.

Every morning at 09:00 Beijing time GitHub checks that the site opens from mainland China (`.github/workflows/mainland-check.yml`): `scripts/check-mainland.mjs` asks [Globalping](https://globalping.io) to fetch it through each server's address from probes in mainland China and in Hong Kong, and the run fails when most of either cannot through either server, so GitHub emails the repository owner. Run it by hand with `node scripts/check-mainland.mjs`.

Every night at 04:00 `scripts/backup.sh` dumps the database into `~/backups` on the server and keeps 14 days. With `~/.zhoupmap-cos` set up it also uploads each dump to Tencent Cloud object storage and keeps only 3 days on the server. Each deploy also copies the newest dump to `~/zhoupmap-backups` on the Mac. The script writes how it went into the database (`watch_state`), for the checks below.

### The second server

A second server in the same cloud region gives the site a second way in, a second share of outgoing bandwidth, and more cores. As the way in, it only passes visitors' connections on to the main server over the cloud's private network, still encrypted: port 443 with the PROXY protocol to Caddy's `:8443`, which takes the visitor's address from that line only when it comes from the second server's private address (`deploy/Caddyfile`), and port 80 as it is. Certificates, the database and Caddy stay on the main server, and this part keeps no logs, so a broken one is replaced rather than repaired: a fresh Ubuntu server with an SSH host entry named `zhoupmap2`, password and root logins turned off, and its cloud firewall open for TCP 22, 80 and 443, then

```bash
scp deploy/relay/nginx.conf scripts/relay-setup.sh zhoupmap2:
ssh zhoupmap2 'bash relay-setup.sh 10.5.0.6'
```

with the main server's private address. The main server's cloud firewall lets TCP 8443 in from the second server's private address only; a new second server with a new private address needs that rule and the `allow` line in `deploy/Caddyfile` changed. The second server also passes the main server's requests to Photon (the overseas place search, which refused the main server's own address) on port 4443, for the main server's private address only (its cloud firewall too), and `PHOTON_VIA` in `docker-compose.prod.yml` sends them there. In DNS both servers' public addresses are A records for `zhoupmap.com` and `www`: pausing one server's two records sends every visitor to the other within ten minutes.

Since 11/11, when the main server's four cores were full, the second server also runs two of the app's three processes, web2 and web3 (`docker-compose.second.yml`, in `~/zhoupmap-b` there). They use the main server's database over the private network: the main server publishes Postgres on its private address only, and its cloud firewall lets TCP 5432 in from the second server only. The main server's Caddy sends their share of visitors to ports 3001 and 3002 on the second server's private address, which its cloud firewall lets in from the main server only. `scripts/deploy.sh` keeps them up to date after the main server's web: the pictures, the compose file, a copy of the main server's `.env` (edit it there only; the next deploy copies it), and the new image. A new second server needs `sudo apt-get install -y docker.io docker-compose-v2` and `sudo usermod -aG docker ubuntu` for them, then a deploy, and the two private addresses in `docker-compose.second.yml`, `docker-compose.prod.yml` and `deploy/Caddyfile` changed if they changed.

### Checks and alerts

The site checks itself every 5 minutes (`src/lib/server/watch.ts`), and each problem it finds is urgent, for the daily digest, or quiet. A problem counts once it has been seen for long enough (memory, for instance, three rounds in a row) and is over once it has been gone for long enough (15 minutes to an hour, a day for things that happened), so a figure hovering at its line makes one incident rather than an email each way. The same problem back within an hour of its end is the same incident again. Incidents are kept 90 days (`watch_incidents`).

Only urgent problems are emailed at once, to `WATCH_EMAILS` (by default `ADMIN_EMAILS`), through the same mail service as the sign-in codes but outside `MAIL_DAILY_LIMIT`; one more email says when one is over. At most 10 such emails go out a day: one over that is noted on the admin page and in the next digest, and never sent later. A problem the admin marks 「知道了」 on the admin page gets no more emails. Every morning at `WATCH_DIGEST_HOUR` Beijing time (9 by default) one digest goes out even when all is well, so a missing one says the site or its mail is broken: what still wants the admin, what was over by itself in the last day (a line a kind), the day's reports, and a few figures (sign-in codes sent, disk, last night's backup, the certificate, 高德's map loads this month, yesterday's new players and 触须之交). A server that was down at that hour sends it when it is back. 网站状态 at the top of `/admin` shows what is open, the last seven days, the same figures and the alert emails sent, and reads them again every minute.

The checks, with what makes each urgent; the rest go into the digest or are only kept on the page:

- the database: unreachable for two rounds (urgent), or slow to answer;
- the app restarting with the same build as before, which a deploy does not: three times in an hour is urgent, once is for the digest. Each of the app's processes says when it starts;
- requests failing with errors, counted over all three processes (the helpers pass on what they noted through Postgres NOTIFY, `src/lib/server/watchSignals.ts`): 100 in ten minutes, or 10 in each of the last three ten minutes, is urgent; 20 in a day is for the digest;
- sign-in code emails: all of `MAIL_DAILY_LIMIT` used in 24 hours, or a pace that would use it up within six hours (once a day), is urgent; 80% is for the digest; most of them failing in a quarter of an hour is urgent; and 30 or more code requests refused by the limits in an hour;
- maps failing in visitors' browsers (Amap's key errors 3 times in 10 minutes for the digest, or 10 reports of any kind in 30 minutes): pages report a map that did not load, Amap's key errors from its console messages, a map still blank after a while, and repeated tile errors to `POST /api/health/map`, which keeps only the map, the kind of trouble and the service's short code, in memory;
- 高德's map loads running out: each visit from mainland China counts as one (an estimate, kept per Beijing month in `watch_state`), and once a month the digest says when 80% of `AMAP_MAP_LOADS` is gone or the month's pace would use it up;
- background jobs failing (the 04:00 jobs, pruning, daily totals, the report reminders; migrations at start are urgent);
- the server: disk 90% full or full within three days at the last three days' pace (urgent), 85% or within a week; under 3% memory available (urgent) or under 10%; a 15-minute load above 1.5 per core;
- the nightly backup: failed, missing for more than 26 hours, or not uploaded; two nights without one that worked is urgent;
- the second way in (`WATCH_DOORS`: the second server's private address): the site not answering through it three times running (urgent);
- the HTTPS certificate, asked of Caddy inside the server's network: under 5 days left is urgent, under 14 for the digest.

Reports of a minor or of contact details are emailed to `ADMIN_EMAILS` within the hour; the other reports wait for the digest.

A site that is down cannot email anyone, so GitHub also asks `GET /api/health` from outside every 10 minutes (`.github/workflows/uptime.yml`), through each server by its address, three tries a minute apart, and emails the repository owner when it fails. The endpoint answers 503 when the database is unreachable, when sign-in code emails are failing (the urgent problem is open), or when the checks' own emails have not gone out for half an hour. GitHub pauses scheduled workflows after 60 days without a push. `WATCH=off` turns the checks off; `WATCH=1` turns them on in development, where they print instead of emailing unless `WATCH_EMAILS` or `ADMIN_EMAILS` is set.

## Roadmap

The project is built in daily iterations, each ending with a playable version:

1. Prototype: dual basemaps, demo roaches, place your own roach
2. MVP: email sign-in, server-side roaches, profiles, touches, declarations, clones, friends, radar
3. Roach customizer and profile cards
4. Follow, block, report, radar, travel trail, public venues
5. Deploy, closed beta
6. Feature freeze, privacy policy, security review
7. Public launch
