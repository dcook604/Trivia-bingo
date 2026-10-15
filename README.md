# Trivia Bingo — self-hosted game for Teams

Built for Daniel's BMO AI & Fraud trivia bingo. One Docker container: the host
console, player cards, and automatic bingo verification over WebSocket.

## How the game runs

1. **Host** opens `/host.html`, enters the host key, and sees all 50 questions
   grouped by round, the called-words board, player count, and the winners list.
2. Host clicks a question, reads it on the Teams call, then hits
   **"Reveal answer & call it"**. The answer word lights up on every player's
   card automatically.
3. **Players** open the root URL on their phone or laptop, enter their name,
   and get a unique 5x5 card (24 terms + FREE center).
4. A player with five in a row hits **BINGO!**. The server verifies the claim
   against the called words (cards are server-generated, so cheating fails)
   and adds them to the winners board with a timestamp.
5. Host can also call a custom word mid-game, and reset everything between rounds.

## Custom words

Edit `data.json`:
- `terms`: the 24 card words (card is 5x5 with a FREE center).
- `questions`: each question's round, text, options, `answer` (must match a
  term exactly to light up on cards), and explanation.

## Deploy on Coolify

1. Push this folder to a git repo (or use Coolify's Dockerfile deployment from
   the repo).
2. New resource → Docker image / Dockerfile. Set:
   - Port: `3000`
   - Environment variable: `HOST_KEY` = a secret only the host knows
     (default is `bingo-host` — change it).
3. Give it a public domain with HTTPS (Coolify/Traefik handles TLS).
   WebSocket runs on the same port, so no extra config is needed.
4. Share the player URL in the Teams meeting chat. Keep `/host.html` for yourself.

## Run locally

```
npm install
HOST_KEY=secret node server.js
# player: http://localhost:3000/   host: http://localhost:3000/host.html
```

## Notes

- Game state (players, called words, winners) persists to `state.json`, so a
  container restart mid-game recovers without losing the board.
- Tested with the full loop: join → call → verified bingo → winner board,
  plus rejection of false bingo claims.
- For ~100 players this is one tiny Node process; no database needed.
