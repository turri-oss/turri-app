// The registry and the work loop turri's chat makes live inside its extension, out of reach. So that the window shows
// the very jobs the chat starts - one work loop for the project, whoever asks - two of turri's factories are wrapped as
// Node loads them: createJobRegistry and createWorkLoop each tell the app what they made. turri itself is not changed.
//
// Imported before anything of turri's is, so the hooks are in place when its modules load.
import { registerHooks } from "node:module";

const app = {
  /** Above 0 while the engine makes a registry or loop of its own, which are not the chat's. */
  own: 0,
  /** Wraps a registry's callbacks as the chat makes one, so the app hears what its jobs do. */
  wrapOptions: (options) => options,
  onRegistry: () => {},
  onLoop: () => {},
};
globalThis.__turriApp = app;

/** `make` run with capture off: what it makes is the engine's own. */
export function own(make) {
  app.own += 1;
  try {
    return make();
  } finally {
    app.own -= 1;
  }
}

export function onCapture(handlers) {
  Object.assign(app, handlers);
}

// Function declarations are mutable bindings in their module, and importers see the new value: reassigning the export
// at the end of the module wraps it for everyone who imports it.
const WRAPS = {
  "/src/regenerate/jobs.ts": `
;{ const made = createJobRegistry; createJobRegistry = (options) => { const app = globalThis.__turriApp; if (app === undefined || app.own > 0) return made(options); const registry = made(app.wrapOptions(options)); app.onRegistry(registry); return registry; }; }
`,
  "/src/regenerate/loop.ts": `
;{ const made = createWorkLoop; createWorkLoop = (options) => { const app = globalThis.__turriApp; const loop = made(options); if (app !== undefined && app.own === 0) app.onLoop(loop, options); return loop; }; }
`,
};

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    const wrap = Object.entries(WRAPS).find(([suffix]) => url.endsWith(suffix))?.[1];
    if (wrap === undefined || result.source === undefined) return result;
    return { ...result, source: `${typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8")}\n${wrap}` };
  },
});
