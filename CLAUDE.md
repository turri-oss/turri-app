# CLAUDE.md

turri-app is a proof of concept: [turri](https://github.com/turri-oss/turri) as a native Electron app for people who do not live in a terminal. It runs turri's own conversation and work loop and shows them in native UI - never a terminal in a window. The README says what the window offers.

## Shape

```
electron/main.ts     the window, native menus, notifications, dock, appearance and zoom - and the bridge to the engine
electron/preload.ts  window.turri: the engine's methods, a few native services, the events the window is sent
engine/engine.mjs    one process per open project: the methods the window calls, and the events it emits
engine/chat.mjs      pi's agent session with turri's extension; its UI calls become window events
src/                 the window: React, no UI kit, one stylesheet (styles.css)
```

- **turri comes from npm**, as `@turri-dev/cli/host` - turri's public entry for hosts (`docs/hosting.md` in turri). The engine imports only that; anything else it needs is added to turri's `src/host.ts` first, never reached for by a deep path. The version is pinned exactly, because a 0.x prerelease may change the entry: a push to turri's `main` publishes `@turri-dev/cli@<x>-next.<sha>`, and `npm install @turri-dev/cli@next` takes it. To try a turri not yet published: `npm pack` in the turri clone, then `npm install <the .tgz>` here - and never commit a `package.json` that names a tarball.
- **The engine runs on Electron's own Node**, forked with `ELECTRON_RUN_AS_NODE=1`: the package is compiled JavaScript, so no system Node is involved. Its `console` is turri's terminal output, redirected to `log` events.
- **One work loop per project.** The chat's extension owns the job registry and work loop; `createTurriExtension(host)` hands them to the engine (`onJobs`, `onWorkLoop`, `onJobChange`). The window's buttons say what the person would type - Regenerate is `/regenerate <file>`, Halt is `/halt <module>` - so a button never starts a second loop. The engine's own loops are `dryRun` (Preview plan, drift) and start nothing.
- **turri's questions are window sheets.** `ask_user` reaches the window through `host.dialogs`; the extension's other dialogs (select, confirm, input, editor) through the `uiContext` in `chat.mjs`. A terminal component it draws (`ui.custom`: a panel, a picker) has no window form and resolves at once.

## The window

- **The spec editor is two layers**: a transparent textarea over a `<pre>` coloured by turri's own grammar (`highlightSpec`). They sit in one scrolling box and share every font and padding rule, so they wrap alike - a difference in width or font between them puts the caret on the wrong line. After touching either, measure both (below).
- **Colours are turri's**: turri-dark (the default) and turri-light, from turri's `.pi/themes/` and its ***plain palette, as tokens on `:root[data-theme]` in `styles.css`. Use the tokens; `system` follows macOS. The choice and the zoom level live in `appearance.json` in the app's userData.
- **Fonts**: Zed Mono (`src/fonts/zed-mono/`, SIL OFL, subset to woff2) for everything; Silkscreen only for `.button` and `.logo`. The look is pixels: square corners, 2px borders, hard offset shadows, `steps()` animation.
- **The jellyfish** is turri's own frames (`public/jellyfish/`, from turri's `assets/jellyfish/`), drawn with `image-rendering: pixelated` by `Jellyfish` in `ui.tsx`.

## Checking a change

There is no test suite. `npm run typecheck` and `npm run build`, then look at the real window. `electron/main.ts` has development hooks for that:

```bash
TURRI_APP_OPEN=<project dir>          # open a project at start
TURRI_APP_VIEW=spec|work              # switch to a view
TURRI_APP_SCREENSHOT=<file.png>       # capture the window after ~2.5s and quit
npm run build && TURRI_APP_OPEN=../turri-projects/guestbook TURRI_APP_SCREENSHOT=/tmp/shot.png npx electron .
```

For anything a screenshot cannot show - layer sizes, fonts loaded, a menu action - load `dist-electron/main.cjs` from a small script run with `npx electron <script>` and `executeJavaScript` in the window. Such a script runs as the app "Electron": what it saves goes to `~/Library/Application Support/Electron/`, not the app's own userData; clean up there afterwards.

Regenerate, Preview plan and every chat message call the project's models and spend money; Regenerate also changes the project. Check with what calls no model - opening a project, the spec, slash commands that only print (`/stdlib`) - unless the person asks for a real run.

## Conventions

- The name is **turri**, lowercase, even at the start of a sentence; ***plain is written `***plain`.
- Prose in docs, comments and user-facing strings uses British spelling and a spaced hyphen ` - `, not an em dash.
- Commit messages follow Conventional Commits, as in turri: `feat(ui): ...`, `fix(editor): ...`, the description lowercase and saying what the app now does.
- When what the window offers or how it is set up changes, update the README in the same commit.
