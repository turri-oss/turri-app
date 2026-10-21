# Development

How the app is put together, and how to run it from source. For what the window offers, see [the window](window.md).

## How it is put together

```
electron/main.ts     the windows - one per project - native menus, notifications, dock - and the bridge to each window's engine
electron/preview.ts  the preview pane, and what turri's browser tools do in it
electron/terminal.ts the preview's terminal - a shell on a pty - and what turri's terminal tools do in it
electron/preload.ts  what the window may ask of the app (window.turri)
engine/engine.mjs    a Node process per open project that imports turri's src/: the chat, the spec, the work
engine/chat.mjs      pi's agent session with turri's extension; its dialogs and notices become window events
engine/browser.mjs   the browser tools, a pi extension of the app's own beside turri's
engine/terminal.mjs  the terminal tools, another
src/                 the window: React, no UI kit
```

turri comes from npm, as `@turri-dev/cli` - its host entry, `@turri-dev/cli/host` (turri's [docs/hosting.md](https://github.com/turri-oss/turri/blob/main/docs/hosting.md)): the chat extension, which hands the engine its jobs and puts `ask_user`'s questions in the window's dialogs, and what the window shows beside it. It is compiled JavaScript, so the engine runs on Electron's own Node; nothing else need be installed. The terminal's pty is node-pty, which ships built for macOS: `npm install` makes its helper executable (`scripts/pty.mjs`), as npm holds back its own install script. Models and credentials are turri's as usual: the project's `config.turri.yaml` and pi's auth. turri's chat records what it does in the project's ledger on its own, as a `host` run; the engine reads it back (`runViews`) when a project opens and as each pulse ends, for the work view's earlier pulses, and hears it live (`onLedgerEvent`) for the failures it says - for looking up only: what runs and what is planned are the work loop's. A turri with no ledger shows neither.

## Running it

```bash
npm install
npm install-scripts approve electron esbuild   # if npm held back their install scripts; then npm rebuild
npm run dev        # Vite with hot reload, Electron on it
npm start          # a production build of the window, in Electron
```

On Linux, `npm install` builds node-pty for Linux, which needs a C++ toolchain (`build-essential` and `python3` on Debian and Ubuntu), and turri sandboxes its agents with bubblewrap (`bubblewrap`). Where the system confines unprivileged namespaces - Ubuntu 24.04 and later - Electron run from `node_modules` may stop with "the SUID sandbox helper binary was found, but is not configured correctly": give its helper to root, `sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`, once after each install.

macOS names an app in the menu bar, the Dock and ⌘-Tab, and draws its icon, from its bundle - in development, the `Electron.app` in `node_modules`. `npm install` runs `scripts/brand.mjs`, which calls it turri and gives it turri's icon and an identifier of its own (`dev.turri.app`: the Dock remembers the name it saw for Electron's), then signs it again ad hoc; `npm run brand` does it by hand. The icon is turri's logo on turri-dark (`build/icon.png`, `build/icon.icns`); `npm run icon` draws it again from `public/jellyfish/logo.svg`.

`npm run dev` runs the app on a turri clone's own sources when there is one beside this one (`../turri`) - for working on turri and the app together; `TURRI_DEV=<path to a clone> npm run dev` takes any other, and `npm run dev:npm` the package from npm, as `npm start` and a release do. Nothing is built or released for it - Node runs turri's TypeScript as it is - so a change to turri is in the app as soon as a project is opened again: each opens an engine of its own. Which turri runs is said on the welcome screen and at the foot of the sidebar - `turri 0.1.9 · npm`, or `turri local · main @ e553476 · 3 uncommitted` - and in the terminal where the app started. A clone without the commit the pinned version was published from is behind what this app is built against: the window says so, in amber, with what to do - `git pull` and `npm install` in it, or `npm run dev:npm` - and runs on it all the same; so does a package other than the pinned one, until `npm install`. The clone needs its own `npm install`.

To try a turri not yet on npm as a package, pack it and install the tarball: `npm pack` in the turri clone, then `npm install <path to the .tgz>` here.

## Checking a change

There is no test suite: `npm run typecheck` and `npm run build`, then look at the real window. `electron/main.ts` has hooks for that - `TURRI_APP_OPEN=<project dir>` opens a project at start, `TURRI_APP_VIEW=spec|work` switches to a view, and `TURRI_APP_SCREENSHOT=<file.png>` captures the window after about 2.5s and quits:

```bash
npm run build && TURRI_APP_OPEN=../turri-projects/guestbook TURRI_APP_SCREENSHOT=/tmp/shot.png npx electron .
```

An app opened from Finder, the Dock or a desktop launcher is given launchd's or the session's few variables - `/usr/bin:/bin:/usr/sbin:/sbin`, no API keys - not the person's shell's. So as it starts, `electron/shell-env.ts` runs their login shell once, interactive (`$SHELL -ilc`, so `~/.zshrc` and `~/.bashrc` are read), takes its environment - its PATH in place of the app's, and every variable the app was not given - and every engine waits for it, so turri, its agents and the testing scripts find the toolchains and credentials the person's terminal has. Started from a terminal (`TERM` set), the app keeps the environment it was given; `TURRI_APP_SHELL_ENV=1` reads the shell's all the same. A shell that takes longer than 10 seconds is given up on, said in the terminal, and the app goes on with what it has. To try it as Finder starts it: `env -i HOME=$HOME USER=$USER SHELL=$SHELL PATH=/usr/bin:/bin:/usr/sbin:/sbin node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`

What differs between macOS and Linux is said in one place on each side: `MAC` in `electron/main.ts` - the window's chrome, the menus, the Dock - and `src/platform.ts` in the window - shortcuts as each system writes them, the key they are pressed with, the file manager's name. To look at the Linux window from a Mac, run it in a container under a virtual display (Xvfb): Debian with Electron's libraries (`libgtk-3-0 libnss3 libgbm1 libasound2`, ...), `npm ci` and `npm run build` in it, then `xvfb-run npx electron --no-sandbox .` with the hooks above. A project opens only with its model's credentials there - dummy ones will do, as opening calls no model.

Regenerate, Preview plan and every chat message call the project's models and spend money; check with what calls none - opening a project, the spec, slash commands that only print - where you can.
