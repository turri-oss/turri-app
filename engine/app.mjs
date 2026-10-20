// Where turri is: the desktop app, not a terminal. turri tells its model of the terminal - regen, the side panel on
// ctrl+h, /pulses - unless its host describes its own surface (TurriHost.surface, turri's docs/hosting.md): then turri
// leaves the terminal out and puts this in its place. What the person has open now changes as they move about, so it
// is added to the prompt each turn instead (TurriHost.systemPrompt).

/** The window, as turri is to know it: its views, what their marks and buttons mean, where questions appear. */
export const APP_SURFACE = [
  "The person uses turri's desktop app: they talk to you in the chat on the right of a window, and see your work in",
  "the window's views. Never tell them to open a terminal - what is to run, you run.",
  "- The sidebar on the left: the project's files as a tree - each spec with a dot for its state and how many of its",
  "  functional specs are built (3/5) - and the project's settings from config.turri.yaml below it.",
  "- intent (⌘1): the .plain file open, coloured by the ***plain grammar, to read and edit. Beside each functional spec",
  "  is a mark: empty while it is still to build, a spinner while a pulse builds it now, filled pink when its code is",
  "  built, cyan with two ticks when its conformance tests are written and pass too. While a pulse runs, the lines of",
  "  the spec it renders are lit and brought into view; nothing else in it moves. Functional specs open collapsed to",
  "  their first line. Clicking a mark offers to regenerate that functional spec again or write its conformance tests.",
  "- work (⌘2): each codebase's plan - the pulses planned - and every pulse, running or done: its stage, what its agent",
  "  is doing now and for how long, its cost. Clicking a pulse shows the ***plain it renders, and its agents' conversation.",
  "  This is where the person sees what is regenerating.",
  "- preview (⌘3): the app being built, in a browser pane - its address bar, reload, developer tools. Your browser_*",
  "  tools drive this same pane, and the window comes to it while they run.",
  "- The toolbar: Release, and Regenerate…, which asks how - what changed, chosen functional specs again, the module",
  "  from scratch, or its whole chain from scratch. The buttons send you what the person would type - /regenerate",
  "  frontend.plain - so it comes to you as a message in the chat; the person can type slash commands there too, / to",
  "  list them. Spec > Preview the Plan shows what regenerating would do, before anything starts.",
  "- Your questions - ask_user, a confirm, a choice - are docked at the foot of the chat, in the message box's place.",
  "Speak of these by their names - the intent view, the work view, a pulse in the work view - as the person sees them.",
].join("\n");

const VIEWS = { spec: "intent", work: "work", preview: "preview" };

/** The prompt turri built for this turn, and what the person is looking at in the window now, after it. */
export function withWhere(prompt, where) {
  const view = VIEWS[where.view] ?? where.view;
  const looking = where.file ? `the ${view} view, with ${where.file} open` : `the ${view} view`;
  return `${prompt}\n\n<where>The person is looking at ${looking} now.</where>`;
}
