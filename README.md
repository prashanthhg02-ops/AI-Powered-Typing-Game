# AI-Powered-Typing-Game
# Keyflow — AI-Powered Typing Game

A responsive, browser-based typing game with a small on-device adaptive coach. It needs no build step, API key, account, or server.

## Run it

Open `index.html` in a modern browser. For a local web server, run:

```bash
python -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

## How the adaptive coach works

The game tracks missed letters during a round in memory and selects the next adaptive passage to include frequently missed keys when possible. Adaptive difficulty also responds to the best WPM recorded on the device. At the end of each round, the coach offers a tip based on accuracy, speed, and repeated mistakes.

Practice statistics (session count and best WPM) are stored in browser local storage. Raw keystrokes and mistake patterns are not uploaded or persisted. The game includes easy, medium, and hard levels, 30/60/120-second rounds, WPM and accuracy tracking, an optional completion chime, keyboard restart (Tab), and pause/reset (Escape).
