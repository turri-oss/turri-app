# turri-app

A proof of concept: [turri](https://github.com/turri-oss/turri) as a native desktop app, for people who do not live in a terminal.

It is not a terminal in a window. The app hosts turri's own chat - pi's agent session with turri's extension, its tools, slash commands, rules and skills - and the job registry and work loop it drives, and shows what they do in native UI:

- **turri** - the conversation, on the right (⌘J): turri writes the spec with you and regenerates the code from it. Replies stream in, tool calls show as what they do ("Edited backend.plain"), a pulse that ends is a card in the chat, and when turri asks you something - `ask_user`, a confirm, a choice - it is a sheet over the window with the options as buttons. Type `/` for its commands.

- **Spec** - the `.plain` file, coloured by turri's own ***plain grammar, beside a card for each functional spec showing whether its code is built, and which one is being built right now. Right-click a card (a native menu) to regenerate it again or write its conformance tests. The buttons go through the chat - Regenerate is `/regenerate backend.plain` - so there is one work loop, whoever asks.
- **Work** - each codebase's plan, and every pulse live: its stage, what its agent is doing and for how long, what it cost. Click a pulse to read its agents' conversation as chat bubbles.
- **Preview plan** - `turri glimpse`: the pulses Regenerate would run, and what the coding agent would be told, before anything starts.
- Native menus and shortcuts (⌘O, ⌘S, ⌘R, ⇧⌘P, ⌘., ⌘1-2, ⌘J, and ⌘+ ⌘− ⌘0 to zoom the text, remembered), recent projects, a dock badge and progress while pulses run, and a notification when one lands while the window is in the background.
- turri's look, in pixels: turri-dark by default, turri-light or the system's as chosen (View > Appearance, or the switch in the sidebar). Zed Mono for everything but the main buttons and the logo, which are in Silkscreen's pixels - Zed Mono (Zed's Iosevka build, SIL OFL 1.1, subset to woff2 in `src/fonts/zed-mono/` with its licence) for code and the spec; square corners and hard shadows. turri's jellyfish (its own frames, `public/jellyfish/` from turri's `assets/jellyfish/`) swims on the welcome screen, and in the chat and the sidebar while turri works.

## How it is put together

```
electron/main.ts     the window, native menus, notifications, dock - and the bridge to the engine
electron/preload.ts  what the window may ask of the app (window.turri)
engine/engine.mjs    a Node process per open project that imports turri's src/: the chat, the spec, the work
engine/chat.mjs      pi's agent session with turri's extension; its dialogs and notices become window events
src/                 the window: React, no UI kit
```

turri comes from npm, as `@turri-dev/cli` - its host entry, `@turri-dev/cli/host` (turri's [docs/hosting.md](https://github.com/turri-oss/turri/blob/main/docs/hosting.md)): the chat extension, which hands the engine its jobs and puts `ask_user`'s questions in the window's dialogs, and what the window shows beside it. It is compiled JavaScript, so the engine runs on Electron's own Node; nothing else need be installed. Models and credentials are turri's as usual: the project's `config.turri.yaml` and pi's auth.

## Running it

```bash
npm install
npm install-scripts approve electron esbuild   # if npm held back their install scripts; then npm rebuild
npm run dev        # Vite with hot reload, Electron on it
npm start          # a production build of the window, in Electron
```

To try a turri not yet on npm, pack it and install the tarball: `npm pack` in the turri clone, then `npm install <path to the .tgz>` here.

## What is not here yet

- The extension's own terminal panels (the side panel, `/lineage`'s picker, `/turri-config`): anything drawn as a terminal component other than `ask_user`'s question is closed at once. The window has its own Work view instead.
- Resuming a conversation: each open starts a new one.
- New projects (init-config, a first spec), the settings as a form, stacks, release and `activate`, spec conflicts and start-overs as dialogs.
- Packaging: a signed `.app`. turri and its Node are in it already - the package in `node_modules`, Electron's Node - so it is electron-builder's work, and signing.
