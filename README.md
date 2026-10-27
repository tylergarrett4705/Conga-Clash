# Morale Arcade

Morale Arcade is a real-time multiplayer, tap-only browser party game hosted by DJ Disco. Players join from phones or laptops using a four-letter room code, then compete through eight synchronized arcade rounds.

## Alpha milestone

The current public alpha includes:

- Room creation, codes, open rooms, and 2-8 human players
- Host controls, host migration, reconnect reservations, and late-player waiting
- Practice mode and easy Off-Beat bots
- DJ Disco round introductions and synchronized countdowns
- Eight-round Party Mode loop using the first minigame, Off-Beat
- Shared seeded crowd generation, authoritative server tap judging, scoring, standings, and final podium
- Mobile-first controls, sound effects, mute, and a three-step tutorial
- Lightweight `/health` and `/ready` endpoints

Pump It!, Drop the Beat, Morale Moves, the daily challenge, and durable global records are scheduled for the next milestones.

## Run locally

Requires Node.js 20 or newer and no third-party packages.

```bash
npm start
```

Open `http://localhost:3000`. Open multiple browser windows to test multiplayer locally.

## Architecture

The Node server owns rooms, game phases, authoritative scoring, and tap judgments. There is no continuous movement or server simulation loop. Each Off-Beat round sends a shared random seed and synchronized timestamps. Browsers independently generate and animate the same crowd, while only player taps and phase changes travel over the network.

## Deployment

The existing Render Blueprint keeps the alpha continuously deployable from `main`. The final submission will move to a separately named Morale Arcade service so its public URL does not contain the previous game name.
