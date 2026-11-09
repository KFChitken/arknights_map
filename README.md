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
| Antenna touches: touch another roach sneakily (they only learn they were touched) or boldly (they can see your profile); they are told at once if the page is open (a server-sent event stream), otherwise on their next visit, and can touch back | MVP |
| Antenna friends: two players who have touched each other boldly become friends, and can see each other's roaches, declaration count and recent activity; either side can end it | MVP |
| Declarations: one of nine canned shouts such as "Arknights, start!", "I'll always love &lt;favourite&gt;" or "Happy birthday to me", sent to every player with a roach within 10 km of the main roach, any chosen clones, or all of them; each player hears it once and can answer with one of six fixed reactions | MVP |
| Email sign-in with a 6-digit code; sign-up is for players aged 18 and over, who tick that they are (no birth date is asked for) and give the storage-and-mail consent on its own; account deletion | MVP |
| 摄入酒精: a player's main roach gets drunk and lies belly up on everyone's map until 8:00 where it lies (or until they sober up or move it); the feed only says it is asleep, never why; 50 drinks earn a badge | MVP |
| Demo players and test identities: thousands of seeded players, and stepping into any of them on one device to try touches and declarations | Development aid |
| Follow requests that need approval, block and report | Planned |
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

That installs Docker, adds swap for builds, clones the repository and writes a `.env` with fresh secrets. Fill in the Amap key and the SMTP settings of the mail service there. Set `ADMIN_EMAILS` to the sign-in email of whoever handles reports: that account can open `/admin`, and gets one email a day when new reports come in. After that, every update is a push to `main` followed by:

```bash
scripts/deploy.sh
```

GitHub builds the app image for every push to `main` (`.github/workflows/image.yml`, which needs the `AMAP_KEY` and `AMAP_SECURITY_CODE` repository secrets, and builds in the Tencent Location Service key from an optional `TENCENT_KEY` secret) and publishes it as `ghcr.io/kfchitken/arknights_map`. The deploy script waits for that build, then the server pulls `main`, downloads the image and restarts; if the build failed or the image cannot be downloaded, the server builds it itself. Images never contain `.env`: the server's secrets are read when the container starts. Database migrations run when the app starts.

Our own overseas map lives in `~/arknights_map/tiles` on the server, outside git, and Caddy serves it at `/tiles`. The map file is a cut of one Protomaps build down to zoom 12 (about 18 GB), fetched by the server itself with [go-pmtiles](https://github.com/protomaps/go-pmtiles):

```bash
pmtiles extract https://build.protomaps.com/20261105.pmtiles ~/arknights_map/tiles/world-20261105.pmtiles --maxzoom=12 --download-threads=4
```

A newer build goes in under its own date, with `OVERSEAS_TILES` in `src/lib/overseas.ts` changed to match. The fonts (Noto Sans Regular, Medium and Italic) and the `light` icons of `sprites/v4` come from [basemaps-assets](https://github.com/protomaps/basemaps-assets) into `tiles/fonts` and `tiles/sprites` on the Mac, and each deploy copies them over. For local development put a small cut (`--bbox=...`) under the same name in `tiles/`, and open `localhost:3000/?mainland=1` to see the site as a visitor from mainland China would.

Every morning at 09:00 Beijing time GitHub checks that the site opens from mainland China (`.github/workflows/mainland-check.yml`): `scripts/check-mainland.mjs` asks [Globalping](https://globalping.io) to fetch it from probes in mainland China and in Hong Kong, and the run fails when most of either cannot, so GitHub emails the repository owner. Run it by hand with `node scripts/check-mainland.mjs`.

Every night at 04:00 `scripts/backup.sh` dumps the database into `~/backups` on the server and keeps 14 days. With `~/.zhoupmap-cos` set up it also uploads each dump to Tencent Cloud object storage and keeps only 3 days on the server. Each deploy also copies the newest dump to `~/zhoupmap-backups` on the Mac. The script writes how it went into the database (`watch_state`), for the checks below.

### Checks and alerts

The site checks itself every 5 minutes (`src/lib/server/watch.ts`) and emails `WATCH_EMAILS` (by default `ADMIN_EMAILS`) through the same mail service as the sign-in codes, outside `MAIL_DAILY_LIMIT` and at most 24 emails a day. One email tells what is new, what is still wrong six hours after the last email about it, and what is over. It looks at:

- the database: unreachable, or slow to answer;
- a restart that was not a deploy (the same build as before), and requests failing with errors (5 or more in 10 minutes);
- sign-in code emails: 80% of `MAIL_DAILY_LIMIT` used in 24 hours, all of it used, sends failing, and 30 or more code requests refused by the limits in an hour;
- maps failing in visitors' browsers (Amap's key errors 3 times in 10 minutes, or 10 reports of any kind in 30 minutes): pages report a map that did not load, Amap's key errors from its console messages, a map still blank after a while, and repeated tile errors to `POST /api/health/map`, which keeps only the map, the kind of trouble and the service's short code, in memory;
- 高德's map loads running out: each visit from mainland China counts as one (an estimate, kept per Beijing month in `watch_state`), and once a month an email says when 80% of `AMAP_MAP_LOADS` is gone or the month's pace would use it up;
- background jobs failing (the 04:00 jobs, pruning, daily totals, the report digest, migrations at start);
- the server: disk 85% full, under 10% memory available, a 15-minute load above 1.5 per core;
- the nightly backup: failed, missing for more than 26 hours, or not uploaded;
- the HTTPS certificate, asked of Caddy inside the server's network, with less than 14 days left.

A site that is down cannot email anyone, so GitHub also asks `GET /api/health` from outside every 10 minutes (`.github/workflows/uptime.yml`), three tries a minute apart, and emails the repository owner when it fails. The endpoint answers 503 when the database is unreachable or the site's emails fail. GitHub pauses scheduled workflows after 60 days without a push. `WATCH=off` turns the checks off; `WATCH=1` turns them on in development, where they print instead of emailing unless `WATCH_EMAILS` or `ADMIN_EMAILS` is set.

## Roadmap

The project is built in daily iterations, each ending with a playable version:

1. Prototype: dual basemaps, demo roaches, place your own roach
2. MVP: email sign-in, server-side roaches, profiles, touches, declarations, clones, friends, radar
3. Roach customizer and profile cards
4. Follow, block, report, radar, travel trail, public venues
5. Deploy, closed beta
6. Feature freeze, privacy policy, security review
7. Public launch
