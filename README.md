# turri-app

A proof of concept: [turri](https://github.com/turri-oss/turri) as a native desktop app, for people who do not live in a terminal.

It is not a terminal in a window. The app hosts turri's own engine - its job registry and work loop, the same objects the chat and `turri regenerate` drive - and shows what they do in native UI:

- **Spec** - the `.plain` file, coloured by turri's own ***plain grammar, beside a card for each functional spec showing whether its code is built, and which one is being built right now. Right-click a card (a native menu) to regenerate it again or write its conformance tests.
- **Work** - each codebase's plan, and every pulse live: its stage, what its agent is doing and for how long, what it cost. Click a pulse to read its agents' conversation as chat bubbles.
- **Code** - the regenerated code, browsable, with Show in Finder and Open.
- **History** - the module's lineage (`.plaingit`): every pulse that landed, with its diff.
- **Preview plan** - `turri glimpse`: the pulses Regenerate would run, and what the coding agent would be told, before anything starts.
- Native menus and shortcuts (⌘O, ⌘S, ⌘R, ⇧⌘P, ⌘., ⌘1-4), recent projects, a dock badge and progress while pulses run, and a notification when one lands while the window is in the background. Light and dark follow the system.

## How it is put together

```
electron/main.ts     the window, native menus, notifications, dock - and the bridge to the engine
electron/preload.ts  what the window may ask of the app (window.turri)
engine/engine.mjs    a Node process per open project that imports turri's src/ and hosts its work loop
src/                 the window: React, no UI kit
```

The engine runs on the system's Node (>= 22.19), not Electron's, because turri runs its TypeScript unbuilt through Node's type stripping. It imports turri from `../turri` (a clone beside this one), or from `TURRI_HOME`. Models and credentials are turri's as usual: the project's `config.turri.yaml` and pi's auth.

## Running it

```bash
# beside a clone of turri: ../turri, with its npm install done
npm install
npm install-scripts approve electron esbuild   # if npm held back their install scripts; then npm rebuild
npm run dev        # Vite with hot reload, Electron on it
npm start          # a production build of the window, in Electron
```

`TURRI_NODE` names the Node to run the engine on, when the one on your login shell's PATH is not it.

## What is not here yet

- Talking to turri. The chat - where turri writes the spec with you - is the heart of the terminal experience, and this PoC has only the editor. It would be pi's agent session over the same bridge, its tool calls shown as cards.
- New projects (init-config, a first spec), the settings as a form, stacks, release and `activate`, spec conflicts and start-overs as dialogs.
- Packaging: a signed `.app` would bundle turri and a Node.
