# Roach Map

A friend-finding map for **Arknights** and **Arknights: Endfield** players.

Players in the community jokingly call themselves "roaches" because there seem to be so many of them, yet most never meet another player offline. Roach Map gives every player a small cartoon roach that sits on a world map, so you can see how many players are around you and make friends nearby.

> Unofficial fan project. Not affiliated with or endorsed by Hypergryph. Non-commercial.

## Features

| Feature | Status |
|---|---|
| World map with two basemaps behind one URL (Amap inside mainland China, MapLibre + OpenStreetMap elsewhere), auto-selected with a manual switch | Prototype |
| Clustered roach "nests" that break into individual roaches as you zoom in | Prototype |
| Place your own roach anywhere on the map | Prototype (stored in the browser) |
| Email sign-in, server-side storage, location fuzzing | Planned |
| Roach customizer and profile card (main operators, interests) | Planned |
| Follow requests that need approval, block and report | Planned |
| "Ark Radar" nearby counts and your roach's travel trail | Planned |

## Privacy by design

Location sharing combined with a social feature is a stalking risk, so the privacy rules come before features:

- **No GPS.** Players place their roach by hand. Nothing reads the device location.
- **Fuzzy public positions.** Only you see your exact placement. Everyone else sees a position snapped to a ~1 km grid plus a fixed per-user offset, so refreshing or averaging cannot recover the real point. This holds even between mutual followers.
- **Anonymous by default.** Strangers only see an anonymous roach. A player's game ID is shown only after both sides follow each other, and following requires approval.
- **Blocking hides you completely** from the blocked player's map and radar.
- **The radar shows ranges, never distances** ("10–20 roaches within 5 km"), because exact distances allow trilateration.
- **Public venues** (conventions, merch shops) are the only places that can be marked precisely.

## Tech stack

- Next.js (App Router) + TypeScript, frontend and API in one project
- Amap JS API 2.0 for mainland China, MapLibre GL JS + OpenFreeMap tiles elsewhere
- Coordinates stored as WGS-84 and converted to GCJ-02 for Amap with `gcoord`
- PostgreSQL + PostGIS (planned), deployed with Docker Compose on a Hong Kong VPS

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
