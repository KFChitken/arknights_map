# Roach Map

A friend-finding map for **Arknights** and **Arknights: Endfield** players.

Players in the community jokingly call themselves "roaches" because there seem to be so many of them, yet most never meet another player offline. Roach Map gives every player a small cartoon roach that sits on a world map, so you can see how many players are around you and make friends nearby.

> Unofficial fan project. Not affiliated with or endorsed by Hypergryph. Non-commercial.

## Features

| Feature | Status |
|---|---|
| World map with two basemaps behind one URL (Amap inside mainland China, MapLibre + OpenStreetMap elsewhere), auto-selected with a manual switch | Prototype |
| Swarm view: every roach is drawn and twitches, and a dark heat layer makes crowded cities look covered in roaches; cartoon or realistic roaches | Prototype |
| Place a main roach and up to three clones by tapping the map or searching for a place (Amap POI search in China, OpenStreetMap Nominatim elsewhere) | Prototype (stored in the browser) |
| Profile: a name with an optional "Dr." prefix or stay anonymous, games played, up to three favourite characters per game, an optional game UID | Prototype (stored in the browser) |
| Antenna touches: touch another roach sneakily (they only learn they were touched) or boldly (they can see your profile); they are told on their next visit and can touch back | Prototype (stored in the browser) |
| Antenna friends: two players who have touched each other boldly become friends, and can see each other's roaches (still fuzzed), declaration count and recent activity; either side can end it | Prototype (stored in the browser) |
| Declarations: a canned shout such as "Arknights, start!" or "I'm &lt;favourite&gt;'s &lt;title&gt;" to every player with a roach within 10 km | Prototype (stored in the browser) |
| Test identities: step into other players' shoes on one device to try touches and declarations | Development aid |
| Email sign-in, server-side storage | Planned |
| Follow requests that need approval, block and report | Planned |
| "Ark Radar" nearby counts and your roach's travel trail | Planned |

## Privacy by design

Location sharing combined with a social feature is a stalking risk, so the privacy rules come before features:

- **No GPS.** Players place their roach by hand. Nothing reads the device location.
- **Fuzzy public positions.** Only you see your exact placement. Everyone else sees a position snapped to a ~1 km grid plus a fixed per-roach offset, so refreshing or averaging cannot recover the real point. This holds even between mutual followers.
- **Anonymous by default.** Strangers only see an anonymous roach. A bold touch shows the toucher's profile to the player they touched; a sneaky touch shows nothing. Game UIDs stay hidden unless their owner chooses to show them to the players they touch boldly.
- **Touches and declarations never carry a position.** A declaration reaches everyone with a roach within 10 km of the sender's main roach; recipients only learn "within 10 km", and the sender only gets a rough head count ("5–10 players").
- **Friendship is opt-in on both sides.** Only two bold touches, one each way, make players friends; sneaky touches never count. Friends see each other's roaches at the same fuzzed positions as everyone else, and other players in a friend's activity stay anonymous.
- **Clones cannot be traced back.** Every clone looks the same, gets a new public id whenever it moves, and is listed in random order, so nobody but the owner's friends can tell which main roach it belongs to. Touching a clone reaches its owner without revealing anything about them.
- **Blocking hides you completely** from the blocked player's map and radar.
- **The radar shows ranges, never distances** ("10–20 roaches within 5 km"), because exact distances allow trilateration.
- **Public venues** (conventions, merch shops) are the only places that can be marked precisely.

## Tech stack

- Next.js (App Router) + TypeScript, frontend and API in one project
- Amap JS API 2.0 for mainland China, MapLibre GL JS + OpenFreeMap tiles elsewhere
- Coordinates stored as WGS-84 and converted to GCJ-02 for Amap with `gcoord`
- Player data lives in the browser for now, behind a small data-layer interface (`src/lib/world`) that already applies the privacy rules above; moving to a server means implementing the same interface over an API
- PostgreSQL + PostGIS (planned), deployed with Docker Compose on a Hong Kong VPS
- Character names come from the BWIKI operator lists (names only)

## Run locally

You need an Amap **Web (JS API)** key and its security code for the China basemap. Without them the app falls back to the OpenStreetMap basemap.

```bash
cp .env.example .env    # then fill in the Amap key and security code
```

With Docker:

```bash
docker compose up --build
```

Or with Node.js 20+:

```bash
npm install
npm run dev
```

Open http://localhost:3000. To try it on a phone, connect the phone to the same Wi-Fi and open `http://<your computer's IP>:3000`.

The 👤 button at the top switches between test identities: yourself, a few test players (the Shanghai ones are within 10 km of each other) and any passer-by you touched. Switching works like signing in as that player, so touches, the next-visit notice and declarations can all be tried on one device. Everything is stored in that browser only, and the switcher can wipe it.

Run the unit tests (location fuzzing and the data layer):

```bash
npm test
```

Append `?style=blank` to the URL to replace the OSM basemap with a plain background when the tile server is unreachable.

## Roadmap

The project is built in daily iterations, each ending with a playable version:

1. Prototype: dual basemaps, demo roaches, place your own roach
2. MVP: email sign-in, server-side roaches, location fuzzing with tests
3. Roach customizer and profile cards
4. Follow, block, report, radar, travel trail, public venues
5. Deploy, closed beta
6. Feature freeze, privacy policy, security review
7. Public launch
