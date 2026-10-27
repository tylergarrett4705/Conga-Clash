# Conga Clash

Conga Clash is a real-time multiplayer browser game for 2 to 12 players. Players steer conga-line leaders, collect loose dancers, break opponents' lines, use dance-floor power-ups, and compete for the longest line before the two-minute timer ends.

## Run locally

Requires Node.js 20 or newer and no third-party packages.

```bash
npm start
```

Open `http://localhost:3000`. To test multiplayer locally, open several browser windows. Devices on the same Wi-Fi can join through the host computer's LAN address.

## Controls

- Phone or tablet: drag on the arena to steer and hold **Shimmy** to boost.
- Laptop: arrow keys or mouse to steer and spacebar to Shimmy.

## Architecture

The Node server owns room state, movement, collision detection, timers, loose dancers, bots, and scoring. Browsers transmit control intent and receive snapshots at 15 Hz. The client renders the shared simulation on Canvas with a local follow camera and full-arena mini-map.

## Deployment

The application is a single Node service. Deploy the repository to any Node-compatible host, set the start command to `npm start`, and expose the supplied `PORT` environment variable. WebSocket upgrade support must be enabled.

## Included features

- Four-letter room codes and open-room list
- Practice mode and easy CPU opponents
- Two-minute rounds with countdown, collision rules, Shimmy, respawning, and results
- Disco Ball, Glow Stick, and Record Scratch power-ups
- Mobile controls, keyboard controls, mouse steering, sound effects, and mute
- Host migration, reconnection reservation, late-join handling, and replay
- Local Moves point storage and a global dance counter

Global statistics currently use in-memory server storage. Connect a durable database before operating multiple server instances or requiring records to survive deployments.
