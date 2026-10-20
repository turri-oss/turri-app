# turri-app

A proof of concept: [turri](https://github.com/turri-oss/turri) as a native desktop app, for people who do not live in a terminal.

It is not a terminal in a window. The app hosts turri's own chat - pi's agent session with turri's extension, its tools, slash commands, rules and skills - and the job registry and work loop it drives, and shows what they do in native UI:

- **Start a new project** - on the landing page (or File > New Project…, ⌘N): name a folder and choose where it goes, then which models it runs on - turri's vendors as `turri init-config` offers them, Amazon Bedrock's maker and geography too. turri writes its `config.turri.yaml` (`initConfig`, from its host entry), the project opens on those models, and the chat starts with what turri wrote and how to sign in to them - ready for turri to write the first spec with you. A folder of that name with files in it already is left alone; a project given up at the models takes its empty folder with it.
- **turri** - the conversation, on the right (⌘J), as wide as you drag its edge (double-click it for the width it starts at): turri writes the spec with you and regenerates the code from it. Replies stream in, tool calls show as what they do ("Edited backend.plain"), a pulse that ends is a card in the chat, and when turri asks you something - `ask_user`, a confirm, a choice - it is docked at the foot of the chat in the message box's place, the options as buttons, and the conversation stays in view above it. While a skill of several phases runs - brood's intent, stack, testing and product - its phases are above the message box: the ones done ticked, the one it is in turning, and what that phase does. Type `/` for its commands.

- **Files** - the whole project as a tree on the left: the specs, each with its state and how much of it is built, and everything beside them - the templates they import, test scripts, resources, readmes, skills, config. Folders are listed as they are opened and again when what is in them changes, and which are open is kept for each project; what turri keeps for itself (`plain_modules`, `dist`, `.turri`) is there, quieter. Any file that is not a spec opens as text - a `.plain` template coloured by turri's grammar - to edit and save with ⌘S; what turri generates is read only, and a file that is not text opens in its own app. Right-click a row to open it elsewhere, reveal it in Finder or copy its path.
- **intent** - the `.plain` file, coloured by turri's own ***plain grammar, with each functional spec's state in the gutter beside it: a filled mark when its code is built, a spinner while it is being built, an empty one while it is still to build - the spec said once, with how much of it is built above it. While a pulse runs, the lines it renders - what its spec change adds, or the functional spec it builds - are lit in the spec and brought into view. When turri edits the file from the chat it is taken in at once, or, over edits not yet saved, offered. Click a mark (a native menu) to regenerate that functional spec again or write its conformance tests. Functional specs open collapsed to their first line, each showing how many lines it hides: click that, the line or the chevron beside its mark to open it, or Expand all to open them all - remembered for next time. The buttons go through the chat - Regenerate is `/regenerate backend.plain` - so there is one work loop, whoever asks.
- **work** - each codebase's plan, and every pulse live: its stage, what its agent is doing and for how long, what it cost. Click a pulse to read its agents' conversation as chat bubbles. Halting a pulse is turri's alone: the window has no Halt or Stop for one.
- **Preview the plan** (Spec menu, ⇧⌘P) - `turri glimpse`: the pulses Regenerate would run, and what the coding agent would be told, before anything starts.
- **Release** - beside Regenerate, once something of the spec is built: it asks turri in the chat to release it - the module's last commit, exported to `dist/<module>` and started on this machine - and then to say how to open it and what to test, functional spec by functional spec.
- Native menus and shortcuts (⌘N, ⌘O, ⌘S, ⌘R, ⇧⌘P, ⌘1-2, ⌘J, and ⌘+ ⌘− ⌘0 to zoom the text, remembered), recent projects, a dock badge and progress while pulses run, and a notification when one lands while the window is in the background.
- turri's look: turri-dark by default, turri-light or the system's as chosen (View > Appearance, or the switch in the sidebar). Neue Montreal for the interface - where it is installed, as it is a commercial font not bundled with the app, and the system's sans otherwise - Zed Mono (Zed's Iosevka build, SIL OFL 1.1, subset to woff2 in `src/fonts/zed-mono/` with its licence) for code and the spec; rounded corners, fine lines and soft shadows. turri's pixel jellyfish, from its pixel kit (`src/pixels/`, `public/jellyfish/`): on the welcome screen and in the empty chat it grows from a polyp, sinks and grows again, then sways; small, its logo mark sits in the sidebar and the chat, and the mascot bobs there while turri works. The app's icon is its logo mark.

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

macOS names an app in the menu bar, the Dock and ⌘-Tab, and draws its icon, from its bundle - in development, the `Electron.app` in `node_modules`. `npm install` runs `scripts/brand.mjs`, which calls it turri and gives it turri's icon and an identifier of its own (`dev.turri.app`: the Dock remembers the name it saw for Electron's), then signs it again ad hoc; `npm run brand` does it by hand. The icon is turri's logo on turri-dark (`build/icon.png`, `build/icon.icns`); `npm run icon` draws it again from `public/jellyfish/logo.svg`.

To try a turri not yet on npm, pack it and install the tarball: `npm pack` in the turri clone, then `npm install <path to the .tgz>` here.

## What is not here yet

- The extension's own terminal panels (the side panel, `/lineage`'s picker): anything drawn as a terminal component other than `ask_user`'s question is closed at once. `/turri-config` asks through the chat's questions, so it works. The window has its own Work view instead.
- Resuming a conversation: each open starts a new one.
- The settings as a form, stacks, spec conflicts and start-overs as dialogs.
- Packaging: a signed `.app`. turri and its Node are in it already - the package in `node_modules`, Electron's Node - so it is electron-builder's work, and signing.
