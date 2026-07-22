# Journey to Be the Great Mage — Mid-Fidelity AR Demo


**Scenario:** Task — Learn a new spell  
**Fidelity:** Mid (interactive AR simulation beyond Figma; not production XR)

Browser-based **pass-through AR demo** of the spell-learning loop:

1. **Observe** — virtual spellbook appears; glowing geometric runes demonstrate the path  
2. **Trace** — draw runes in space with pointer or hand; live feedback  
3. **Combine & cast** — fireball reward on success  

## Run locally

Camera access requires a local server (or `localhost`):

```bash
# From this folder — any static server works
npx --yes serve .
```

Then open the URL shown (e.g. `http://localhost:3000`).

- **Start with Camera** — webcam as AR environment; optional MediaPipe hand tracking if the browser can load it  
- **Demo without Camera** — stylized room backdrop + pointer tracing (best for classroom projectors)

### Controls

| Input | Action |
|---|---|
| Pointer hold / drag | Trace rune |
| Release | Submit stroke (auto success or reset) |
| Pinch (hand mode) | Draw |
| Voice (optional) | “next”, “again”, “cast” |
| Restart chip | Full restart |

## Project structure

```
great-mage-ar/
  index.html          # Shell + HUD
  css/styles.css      # AR chrome, captions, spellbook panel
  js/main.js          # Phase machine (book → demo → trace → cast)
  js/renderer.js      # Canvas: book, runes, fireball
  js/runes.js         # Geometric templates + path scoring
  js/input.js         # Pointer + MediaPipe hands + voice
  assets/*            # Images resources
  README.md
```

## Hardware note (from design doc)

Production target is **pass-through MR headset / AR glasses** with bare-hand tracking. 

This mid-fi build approximates that on a laptop/phone for critique and usability testing without a headset.

## License

Course prototype — for educational use.
