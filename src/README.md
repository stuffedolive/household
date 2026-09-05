# src/

`app.jsx` is the real JSX source for this app — not served by GitHub Pages,
just kept here so an assistant (or anyone else) working on this project has
a proper editable source file instead of reverse-engineering it from the
compiled `index.html`.

## How index.html is built

`index.html` = a small head (CDN script tags, Firebase config/init, `<div
id="root">`) + `src/app.jsx` compiled to plain JS (Babel, React classic
runtime, no JSX left in the output) + a closing `</script></body></html>`
tail.

To rebuild `index.html` after editing `src/app.jsx`:

```js
const fs = require('fs');
const Babel = require('@babel/standalone'); // npm install @babel/standalone
const jsx = fs.readFileSync('src/app.jsx', 'utf8');
const compiled = Babel.transform(jsx, { presets: [['react', { runtime: 'classic' }]] }).code;
// Take the head (everything up to and including the second `<script>` open
// tag in the current index.html — the first `<script>` is the Firebase
// config block) and the tail (`</script></body></html>`) from the existing
// index.html, and splice the compiled JS between them.
```

Babel is intentionally **not** loaded at runtime in `index.html` — it used
to be, but shipping the Babel compiler itself plus re-transforming the app
in-browser on every load was a real, measurable chunk of startup time on
mobile. `index.html` now ships pre-compiled, plain JS only.
