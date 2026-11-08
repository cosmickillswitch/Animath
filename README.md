# Animath

Manim-style animation on your phone: LaTeX-looking maths, graphs, geometry, logic and set theory, title cards, stickers, a timeline with keyframes, and video export in any aspect ratio.

## Files

- `index.html`: the app.
- `core.js`: the engine. Object types (`TYPES`), the maths layout, animations, and rendering. Add a new object type by adding an entry to `TYPES` with `defaults`, `fields` and `build`.
- `editor.js`: the editor: stage, Add panel, inspector, timeline, projects, export. The demo scene is `demoScene()`.
- `app.css`: layout and colours. It also loads KaTeX's Computer Modern fonts (the LaTeX look) from jsDelivr.
- `icon.svg`, `icon-*.png`, `maskable-512.png`, `apple-touch-icon.png`: the logo.
- `manifest.webmanifest`, `sw.js`: make it installable and work offline. Bump `VERSION` in `sw.js` after any change.

## Put it on GitHub Pages

1. Create a repo called `animath` and upload everything in this folder.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://cosmickillswitch.github.io/animath/` and install it from Chrome's menu (⋮ → Install app).
4. Open it once while online so the fonts are saved for offline use.

## How it works

- The frame is 8 units tall, with (0, 0) at the centre and y going up, as in Manim.
- Each object is on screen from its start to its end. It has an entrance animation (Create, Write, Fade, Grow…), an exit (Fade, Uncreate, Shrink, or Transform into another object), optional emphasis moments (Indicate, Circumscribe, Wiggle, Flash…) and optional idle motion.
- Keyframes: tap ◇ next to x, y, scale, rotation or opacity to keyframe it at the playhead. Move the playhead and change the value to animate. Drag diamonds in the timeline to retime them.
- Export records the scene in real time to MP4 (or WebM if the browser can't make MP4). Keep the screen on until it finishes.
