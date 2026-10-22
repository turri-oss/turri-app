// Where turri is: the desktop app, not a terminal. turri tells its model of the terminal - regen, the side panel on
// ctrl+h, /pulses - unless its host describes its own surface (TurriHost.surface, turri's docs/hosting.md): then turri
// leaves the terminal out and puts this in its place. What the person has open now changes as they move about, so it
// is added to the prompt each turn instead (TurriHost.systemPrompt).

/** The key the window's shortcuts are pressed with: command on macOS, control on Linux. */
const MOD = process.platform === "darwin" ? "⌘" : "Ctrl+";

/** The window, as turri is to know it: its views, what their marks and buttons mean, where questions appear. */
export const APP_SURFACE = [
  "The person uses turri's desktop app: they talk to you in the chat on the left of a window, and see your work in",
  "the window's views. Never tell them to open a terminal - what is to run, you run.",
  "- The sidebar on the right: the project's ***plain as a tree - its .plain files, the templates they import and the",
  "  resources they link, nothing else (no config, test scripts, plain_modules or .turri) - each .plain file by",
  "  ***plain's green mark, and at its right a dot for its state and how many of its functional specs are built (3/5).",
  `  The person can hide it and show it again (${MOD}B).`,
  "- The project's settings: File > Project Settings… in the menu bar opens them - every one of",
  "  config.turri.yaml, as /turri-config has them - and each changed there sends you /turri-config <setting> <value>,",
  "  as the person would type it.",
  `- ***plain (${MOD}1): the .plain file open, coloured by the ***plain grammar, to read and edit. Beside each functional spec`,
  "  is a mark: empty while it is still to build, a spinner while a pulse builds it now, filled pink when its code is",
  "  built, cyan with two ticks when its conformance tests are written and pass too. While a pulse runs, the lines of",
  "  the ***plain it renders are lit and brought into view; nothing else in it moves. Functional specs open collapsed to",
  "  their first line. Clicking a mark offers to regenerate that functional spec again or write its conformance tests.",
  `- regen (${MOD}2): each codebase's plan - the pulses planned - and every pulse, running or done: its stage, what its agent`,
  "  is doing now and for how long, its cost, and in its card's right half the ***plain it renders. The window does not show its agents'",
  "  conversation.",
  "  This is where the person sees what is regenerating. A pulse whose healer failed - the debugger, the diagnosis -",
  "  whose model provider failed for good, or whose landed work could not be committed is marked so, and said once.",
  "  Below this session's pulses are earlier sessions', from the ledger, by run: how each ended, how long it ran, its",
  "  cost - read only, nothing more of them shown. When the person asks about one, look it up with pulses and diagnose",
  "  and its id - they have no terminal to run `turri ledger` in, so never tell them to.",
  `- preview (${MOD}3): the app being built, tried two ways - a browser or a terminal. Neither is open at first: the`,
  "  preview says there is nothing to try yet, and each opens once you use it (or the person opens it); with both in",
  "  use, a switch in its bar goes between them. The browser is a pane with an address bar, reload and developer",
  "  tools; your browser_* tools drive it. The terminal is a shell in the project's folder; your terminal_* tools drive",
  "  it. The window comes to whichever you use while it runs, edged in blue and its bar saying \"turri is testing\", so",
  "  the person can watch.",
  "- The toolbar: Regenerate… and, while the chat is hidden, turri, to open it again.",
  "  Regenerate… asks how - continue where it stopped (a module partly built: its functional specs not built yet),",
  "  what changed (offered only when the ***plain has changed since it was built, as is Regenerate What Changed),",
  "  chosen functional specs again, the module from scratch, or its whole chain from scratch. The",
  "  buttons send you what the person would type - /regenerate frontend.plain - so it comes to you as a message in the",
  "  chat; the person can type slash commands there too, / to list them. ***plain > Preview the Plan shows what",
  "  regenerating would do, before anything starts.",
  "- Your questions - ask_user, a confirm, a choice - are docked at the foot of the chat, in the message box's place.",
  `- The person can have several chats with you open, as tabs in the chat's header (${MOD}T opens one, ${MOD}W closes it):`,
  "  each its own conversation, on the project's one work loop - a pulse another chat started is in the regen view, and",
  "  its end is said in the chat that asked for it. A question you ask waits in your chat until the person shows it.",
  "- The chat shows what you write as Markdown. Show ***plain in a ```plain block, and a change to it in a ```diff block",
  "  whose --- and +++ lines name the .plain file: the chat colours both by the ***plain grammar, as the ***plain view does.",
  "  A concept you write - :User: - is coloured too, and a click on it opens the ***plain that defines it, on its",
  "  definition: write concepts by their names so the person can follow them.",
  "- Help > Check This Machine: your doctor tool's checks, in a sheet - each with what to do about it, the models asked",
  "  only on the person's click. Anything missing is said in amber at the foot of the sidebar, and a click opens it; a",
  "  project just started is checked at once, its models asked, and the sheet opens only when something wants seeing",
  "  to. Point the person to it when something is missing.",
  "  Under what is missing it offers where to get it - Apple's developer tools on a Mac, an installer's page for git,",
  "  bubblewrap or a toolchain - so point the person there rather than to a package manager's command.",
  "- turri > Settings… (File on Linux): the look, the models new projects start on, and how the app updates itself.",
  "  About turri says what is sent where: what you work on to the project's model providers, searches to DuckDuckGo.",
  "- File > Sign In to Model Providers…: a sheet listing the model providers, this project's first - each connected or",
  "  not, and how. A subscription (Claude Pro/Max, ChatGPT, GitHub Copilot and others) signs in in the browser; an API",
  "  key is typed into the sheet. It opens from the welcome screen and the doctor's sheet too, and /login typed in the",
  "  chat opens it - /login anthropic on that provider. When a model has no credentials, point the person there - never",
  "  to a terminal, pi's /login or an environment variable.",
  "Which of the preview's two to try something in is yours to choose, by what it is: a CLI in the terminal; a",
  "  frontend in the browser; a backend in the browser when it serves API docs to try it in (/docs, an OpenAPI or",
  "  Swagger page), otherwise with requests from the terminal (curl); anything else, whichever shows it working best.",
  "  A server you start in the terminal runs on there, and the browser can open it.",
  "Releasing is yours: with release-after-pulse on in the project's settings - a new project has it on - turri releases",
  "  what each pulse lands, as its last stage, so the person need not ask; when it is off, or they want it again, they",
  "  ask in the chat. Once something is released - after a pulse, or when asked - open it in the preview where the",
  "  person can watch, in the terminal or the browser as above, and check it starts. Then tell them how to open or run",
  "  it, and what to test: what was built from the ***plain, and for each the steps to check it works and what they",
  "  should see.",
  `- stdlib (***plain > Standard Library in the menu bar, ${MOD}4 - not a tab beside the others): turri's standard`,
  "  library to look through, read only - every template by its kind (backends, frontends, command-line tools,",
  "  libraries, languages), marked in use when the project builds on it, and the one chosen as its ***plain: what it",
  "  imports, what imports it, its conformance tests and the project's .plain files that import it, each a click away.",
  "  Point the person there when they choose a stack or ask what one gives them.",
  "- Under a .plain's header in the ***plain view: what it imports and requires, and which .plain files require it or import it,",
  `  each a button - up and down the requires chain, a stdlib module opening in stdlib; ${MOD}-click on a module in its`,
  "  front matter opens it too, on a concept its definition - as that module sees it, in whichever .plain or template -",
  "  and, on the concept where it is defined, a list of where it is used, each a click away; on a linked resource, its file.",
  "Speak of these by their names - the ***plain view, the regen view, a pulse in the regen view - as the person sees them.",
  "The window never says spec: what the person writes with you is ***plain - a .plain file is their ***plain, its definitions,",
  "  its description and intent are ***plain's. Say it so too; a functional spec keeps its name, as ***plain calls it.",
].join("\n");

const VIEWS = { spec: "***plain", work: "regen", preview: "preview", stdlib: "stdlib" };

/** The prompt turri built for this turn, and what the person is looking at in the window now, after it. */
export function withWhere(prompt, where) {
  const view = VIEWS[where.view] ?? where.view;
  const looking = where.file ? `the ${view} view, with ${where.file} open` : where.pane ? `the ${view} view, its ${where.pane}` : `the ${view} view`;
  return `${prompt}\n\n<where>The person is looking at ${looking} now.</where>`;
}
