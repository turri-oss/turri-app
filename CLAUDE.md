# CLAUDE.md

turri-app is a proof of concept: [turri](https://github.com/turri-oss/turri) as a native Electron app for people who do not live in a terminal. It runs turri's own conversation and work loop and shows them in native UI - never a terminal in a window. The README says what the window offers.

## Shape

```
electron/main.ts     the window, native menus, notifications, dock, appearance and zoom - and the bridge to the engine
electron/turri-version.ts  which turri runs - npm's pinned version, or a clone at a commit - and whether it is behind
electron/preview.ts  the preview: a WebContentsView over the Preview view's space, and the browser tools' actions in it
electron/preload.ts  window.turri: the engine's methods, a few native services, the events the window is sent
engine/engine.mjs    one process per open project: the methods the window calls, and the events it emits
engine/chat.mjs      pi's agent session with turri's extension; its UI calls become window events
engine/browser.mjs   browser tools on the preview: a pi extension of the app's, loaded beside turri's
engine/app.mjs       where turri is: the window as turri's host surface, and what the person has open, each turn
src/                 the window: React, no UI kit, one stylesheet (styles.css)
```

- **turri comes from npm**, as `@turri-dev/cli/host` - turri's public entry for hosts (`docs/hosting.md` in turri). The engine imports only that, through `engine/turri.mjs`; anything else it needs is added to turri's `src/host.ts` first, never reached for by a deep path. For working on both at once, `TURRI_DEV=<clone>` loads the clone's `src/host.ts` instead - `npm run dev` sets it to `../turri` when that is there, `npm run dev:npm` keeps the package - Node runs its TypeScript as it is, so no build - and a change to turri is in at the next project opened. The version is pinned exactly, because a 0.x prerelease may change the entry: a push to turri's `main` publishes `@turri-dev/cli@<x>-next.<sha>`, and `npm install @turri-dev/cli@next` takes it. To try a turri not yet published: `npm pack` in the turri clone, then `npm install <the .tgz>` here - and never commit a `package.json` that names a tarball.
- **The engine runs on Electron's own Node**, forked with `ELECTRON_RUN_AS_NODE=1`: the package is compiled JavaScript, so no system Node is involved. Its `console` is turri's terminal output, redirected to `log` events.
- **One work loop per project.** The chat's extension owns the job registry and work loop; `createTurriExtension(host)` hands them to the engine (`onJobs`, `onWorkLoop`, `onJobChange`). The window's buttons say what the person would type - Regenerate is `/regenerate <file>` - so a button never starts a second loop. Halting a pulse is turri's alone: the window offers no Halt or Stop for one. The engine's own loops are `dryRun` (Preview plan, drift) and start nothing.
- **turri's questions are docked in the chat**, in the message box's place - never a sheet over the window. `ask_user` reaches the window through `host.dialogs`; the extension's other dialogs (select, confirm, input, editor) through the `uiContext` in `chat.mjs`. A terminal component it draws (`ui.custom`: a panel, a picker) has no window form and resolves at once - except the `turri-skill` widget, a running skill's phases: `chat.mjs` draws it plain and reads its lines back into `chat:progress`, which the chat shows above its message box.
- **turri is told it is in the app.** turri's prompt speaks of its terminal - the side panel on ctrl+h, /pulses - unless its host gives a surface (`TurriHost.surface`, turri's docs/hosting.md): then it leaves the terminal out and puts the host's words in its place. `APP_SURFACE` in `engine/app.mjs` is the window in those words; `TurriHost.systemPrompt` adds, each turn, which view and file the person has open (the window says it with `look`). When the window changes - a view, a button, a mark - say it in `APP_SURFACE` too. A turri without `surface` (0.1.7 and before) ignores both.
- **The preview is a page of its own**, in a browser session of its own - in memory, new for each project opened - a `WebContentsView` the main process lays over the rectangle `PreviewView` reports - in the window's pixels, its CSS ones times the zoom. Nothing of the window draws over it: while a sheet is open it is taken away (`covered`), and so are its empty and failed states, which the window draws in its place. turri's browser tools (`engine/browser.mjs`) are the app's, not turri's: each is a request from the engine to the main process (`{ browser, id, params }`, answered `{ browserReply }`), done in that same pane, which the window shows while they run. They go to localhost only. Clicks and typing run in the page as the person's gesture, so the pages they open are in its history; what runs in the page is a function sent as its source, and says what went wrong rather than throwing. Only the newest screenshot is sent to the model as an image, and none once a model has refused one (the `context` event): the refused turn is marked for pi to retry, and goes on without it.

## The window

- **The spec editor is two layers**: a transparent textarea over a `<pre>` coloured by turri's own grammar (`highlightSpec`). They sit in one scrolling box and share every font and padding rule, so they wrap alike - a difference in width or font between them puts the caret on the wrong line. After touching either, measure both (below).
- **Colours are turri's**: turri-dark (the default) and turri-light, from turri's `.pi/themes/` and its ***plain palette, as tokens on `:root[data-theme]` in `styles.css`. Use the tokens; `system` follows macOS. `--built` (turri's pink) and `--tested` (its neon cyan) are what is regenerated and what is conformance tested, wherever either shows: a functional spec's mark, a pulse's kind. The choice and the zoom level live in `appearance.json` in the app's userData.
- **Fonts**: Neue Montreal (`--sans`, the `--body` token) for the interface - not bundled, a commercial font with no licence yet: used where installed, the system sans otherwise. Zed Mono (`--mono`, `src/fonts/zed-mono/`, SIL OFL, subset to woff2) for code, the spec editor, transcripts and `kbd`. The interface is smooth: rounded corners (`--radius`, `--radius-small`), 1px borders, soft shadows (`--shadow`), eased motion. Only the jellyfish and its logos are pixels.
- **The jellyfish** is turri's pixel kit, from the D5-Lean design: `src/pixels/turri-pixels.js` and `.css` (its animations, in `tp-` classes), and its static SVGs in `public/jellyfish/`. `Jellyfish` in `ui.tsx` draws it: large, `jellyfish-hero.svg` at rest, the kit's swaying hero (`mountSprite`) while turri works, and its lifecycle (`mountJellyfish`: the polyp grows into the jellyfish, sinks, grows again) on the welcome screen and in the empty chat - each mounted in the kit's own pixel box and scaled. Below 48px, `logo-mark.svg` at rest and `jelly-mascot.svg`, bobbing, while turri works. The app icon is drawn from `logo-mark.svg` too (`npm run icon`).

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
- **The interface's own words are lowercase** - turri's brand: buttons, labels, headings, tooltips, placeholders, notices, sentences and all, and no CSS that shows them in capitals. What it shows as it is keeps its case: the spec, code, file names and paths, turri's messages, acronyms (API), other products' names (Finder, Mac) and keys (⌘R).
- Prose in docs, comments and user-facing strings uses British spelling and a spaced hyphen ` - `, not an em dash.
- Commit messages follow Conventional Commits, as in turri: `feat(ui): ...`, `fix(editor): ...`, the description lowercase and saying what the app now does.
- When what the window offers or how it is set up changes, update the README in the same commit.
