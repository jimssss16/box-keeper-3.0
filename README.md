# 📦 Box Nester

A recursive box-pushing puzzle game, inspired by *Patrick's Parabox* style mechanics — built with plain HTML5 Canvas + JavaScript, no build step, no dependencies. Works on desktop (keyboard) and mobile (touch/swipe + on-screen controls).

**[▶ Play it live](#)** *(enable GitHub Pages on this repo and paste the link here)*

## How to play

- **Move**: Arrow keys / WASD (desktop) or the D-pad / swipe (mobile).
- **Push**: Walk into a box to push it forward one tile.
- **Pull**: Toggle **Pull mode** (Shift key or the on-screen button), then move — any box directly behind you gets pulled along, in whichever direction you're facing (up, down, left, or right all work).
- **Collect**: Only the **red box** can absorb other boxes. Push or pull any other box into it to store it inside. Bumping two non-red boxes together does nothing — they just block each other, like solid obstacles.
- **Enter the red box**: Face it and press **E** (or tap "Enter / Exit") to step inside and see everything stored there.
- **Retrieve**: Anything stored inside — including boxes you collected yourself, or cargo a box started with — can be pushed back onto the dashed tile at the center of the room to send it back out. The red box itself never moves; it's the one fixed point everything else gets gathered into.
- **Exit**: Stand on the dashed tile and press **E** again (without pushing anything onto it) to pop back out yourself.
- **Goal**: Get every box in the room into the red box.

## Difficulty

All 20 levels are built as a "hub and spokes" layout: dead-end corridors radiate out from the red box, each ending in a box that can only be freed by walking out and **pulling** it back in (pushing from a dead end is impossible by design — there's nowhere to stand). Longer corridors, more boxes per corridor, and more directions at once raise the difficulty. Levels 6, 9, 12, 16, and 19 add a retrieval twist: the red box starts with something already hidden inside it that you have to go in and bring out before you can finish collecting everything else. Every level has been verified solvable with a scripted engine test before shipping.

## Project structure

```
box-nester/
├── index.html      # Page layout + on-screen controls
├── style.css        # Dark theme UI, responsive for mobile & desktop
├── js/
│   ├── levels.js    # 20 levels of increasing difficulty (data only)
│   └── game.js       # Game engine: recursive world model, input, rendering
└── README.md
```

## How the recursion works

Every box has its own small interior "room". When you push box **B** onto box **A**, B is removed from the current room and placed inside A's interior — so A now visually contains B. You can walk into A to see B sitting in there, or you can just keep playing outside; either way, the win condition is simply: **the room you started in has exactly one box left.**

Levels increase in difficulty by combining:
- more boxes to merge,
- dead-end alcoves that require **pulling** a box out,
- walls that require solving merges in a specific **order** to open a path,
- a few levels where you **start inside a box** and must exit before you can solve the room.

## Running locally

No build tools needed — it's static HTML/JS. Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
# or
python3 -m http.server
```

## Publishing to GitHub Pages

1. Push this folder to a GitHub repo.
2. Go to **Settings → Pages**.
3. Set the source to the `main` branch, root folder.
4. Your game will be live at `https://<username>.github.io/<repo-name>/`.

## Adding your own levels

Open `js/levels.js`. Each level is:

```js
{
  name: "My Level",
  map: [
    "##########",
    "#..P.....#",
    "#..1..2..#",
    "##########",
  ],
  boxColors: { "1": "#3ddc84", "2": "#e91e63" }
}
```

`#` = wall, `.` = floor, `P` = player start, `1`–`9` = boxes (matched to `boxColors`). Add `startInside: "1"` to make the player begin inside that box's interior. Add `"collector": "1"` to mark which digit is the red box for that level (its color is forced to red automatically, and its interior is always bumped to at least 9x9).

To give the collector pre-loaded cargo (for a retrieval puzzle), add `nested`:

```js
collector: "1",
nested: { "1": [ { color: "#e91e63", x: 3, y: 3 } ] }
```

Keep cargo at least 2 tiles from every wall of its room (e.g. `x`/`y` of 2–6 in the 9x9 collector room) — a box placed directly against a wall (and especially in a corner) can never be pushed back out again, a classic Sokoban dead end. The same rule applies to anything a player collects normally: the game always stores new boxes on a safe, non-corner tile so they stay retrievable.

## License

MIT — do whatever you like with it.
