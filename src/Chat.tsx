import MarkdownIt from "markdown-it";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Jellyfish, Spinner } from "./ui.tsx";

export type ChatItem =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; thinking?: string; tools?: Array<{ id: string; name: string; args: unknown }>; error?: string }
  | { role: "toolResult"; id: string; name: string; text: string; isError: boolean; image?: string }
  | { role: "note"; customType?: string; text: string; level?: string }
  | { role: "command"; text: string }
  | { role: "job"; id: string; summary: string; status: string; duration?: string; spent?: string; text: string };

/** A skill running in the chat, where it is in its phases: what turri's terminal draws above its input. */
export type SkillProgress = {
  skill: string;
  phases: Array<{ name: string; state: "done" | "now" | "todo" }>;
  /** "phase 2 of 4", "starting", an attempt after a gate sent it back. */
  where: string | null;
  /** The phase it is in and what it does: "stack - the language, frameworks, ...". */
  about: string | null;
};

/** How full the conversation's context is, and what its own model has cost - the pulses' cost is the work view's. */
export type ChatStats = { percent: number | null; tokens: number | null; contextWindow: number | null; cost: number; spent: number };

export type Question = {
  id: number;
  kind: "select" | "confirm" | "input" | "editor" | "question";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
};


/** Talking to turri: the same conversation `turri` holds in the terminal - its tools, commands and questions - in the window. */
export function Chat(props: {
  items: ChatItem[];
  streaming: ChatItem | null;
  busy: boolean;
  working: string | null;
  running: Map<string, boolean>;
  statuses: Record<string, string>;
  model: string | null;
  /** A project with no spec yet: the hints start one. */
  fresh: boolean;
  /** What typing / offers: turri's commands, prompt templates and skills, as its chat has them. */
  commands: Array<{ name: string; description: string }>;
  onSend: (text: string) => void;
  onAbort: () => void;
  onClose: () => void;
  /** What turri asks now - ask_user, a choice, a confirm - answered where the message box is, until it is answered. */
  question?: Question;
  onAnswer: (value: unknown) => void;
  progress: SkillProgress | null;
  stats: ChatStats | null;
  /** Start the conversation over - unless pulses run, when it says why not. */
  onNewSession: () => void;
  /** A pulse the chat says ended, opened in the work view. */
  onShowPulse: (id: string) => void;
  newSessionBlocked: string | null;
}) {
  const [draft, setDraft] = useState("");
  const question = useLingering(props.question);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [props.items, props.streaming, props.question?.id]);

  useEffect(() => input.current?.focus(), []);

  // Results by the call they answer, shown under it.
  const results = new Map<string, Extract<ChatItem, { role: "toolResult" }>>();
  for (const item of props.items) if (item.role === "toolResult") results.set(item.id, item);

  const send = () => {
    const text = draft.trim();
    if (text === "") return;
    props.onSend(text);
    setDraft("");
    stick.current = true;
  };

  const suggestions = draft.startsWith("/") && !draft.includes(" ") ? props.commands.filter((command) => command.name.startsWith(draft)) : [];
  const statusLine = Object.values(props.statuses).filter(Boolean).join(" · ");

  return (
    <aside className="chat">
      <div className="titlebar-space chat-top">
        <span className="chat-title">
          <Jellyfish size={22} swimming={props.busy} /> turri
        </span>
        {props.model && <span className="chat-model" title={props.model}>{props.model.split("/").at(-1)}</span>}
        <button
          className="icon-button"
          onClick={() => void newSession(props)}
          disabled={props.newSessionBlocked !== null}
          title={props.newSessionBlocked ?? "new session - start the conversation over, forgetting this one"}
          aria-label="new session"
        >
          <Icon name="reload" />
        </button>
        <button className="icon-button" onClick={props.onClose} title="hide the chat (⌘J)">
          <Icon name="x" />
        </button>
      </div>
      <div
        className="chat-body"
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {/* Nothing said yet - notes aside, such as a new project's config - so how to begin is shown. */}
        {props.items.every((item) => item.role === "note") && !props.streaming && (
          <div className="chat-empty">
            <Jellyfish size={110} lifecycle />
            <p>tell turri what you want to build, or what to change. it writes the spec with you, then regenerates the code from it.</p>
            {props.fresh ? (
              <>
                <button
                  className="hint"
                  onClick={() => {
                    setDraft("I want to build ");
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                >
                  i want to build…
                </button>
                <button className="hint" onClick={() => props.onSend("Help me work out what to build: ask me what you need to know, then write the first spec.")}>
                  help me work out what to build
                </button>
              </>
            ) : (
              ["what does this project do?", "add a way to delete a message", "regenerate what changed"].map((hint) => (
                <button key={hint} className="hint" onClick={() => props.onSend(hint)}>
                  {hint}
                </button>
              ))
            )}
          </div>
        )}
        {props.items.map((item, index) => (item.role === "toolResult" ? null : <Message key={index} item={item} results={results} running={props.running} onShowPulse={props.onShowPulse} />))}
        {props.streaming && <Message item={props.streaming} results={results} running={props.running} live />}
        {props.busy && !props.streaming && (
          <div className="chat-working">
            <Jellyfish size={20} /> {props.working ?? "thinking"}
          </div>
        )}
        <div ref={end} />
      </div>
      {props.progress && <ProgressBar progress={props.progress} />}
      {question ? (
        // Known by what it asks, not its id: a question asked again - a box ticked, the rest still to choose - is the
        // same card, changed in place.
        <QuestionCard key={question.title} question={question} waiting={props.question === undefined} onAnswer={props.onAnswer} />
      ) : (
      <div className="composer">
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map(({ name, description }) => (
              <li key={name} onMouseDown={(event) => (event.preventDefault(), setDraft(`${name} `))}>
                <strong>{name}</strong> <span className="muted">{description}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={input}
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          placeholder={props.busy ? "turri hears this when it finishes its turn…" : "talk to turri - or / for a command"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
            if (event.key === "Tab" && suggestions.length > 0) {
              event.preventDefault();
              setDraft(`${suggestions[0]!.name} `);
            }
          }}
        />
        <div className="composer-bar">
          {props.stats && <ChatMeter stats={props.stats} />}
          <span className="muted small composer-status">{statusLine}</span>
          {props.busy ? (
            <button className="button small" onClick={props.onAbort}>
              <Icon name="stop" size={13} /> stop
            </button>
          ) : (
            <button className="button small primary" onClick={send} disabled={draft.trim() === ""}>
              send <kbd>↩</kbd>
            </button>
          )}
        </div>
      </div>
      )}
    </aside>
  );
}

function Message({
  item,
  results,
  running,
  live,
  onShowPulse,
}: {
  item: ChatItem;
  results: Map<string, Extract<ChatItem, { role: "toolResult" }>>;
  running: Map<string, boolean>;
  live?: boolean;
  onShowPulse?: (id: string) => void;
}) {
  const [thinking, setThinking] = useState(false);
  if (item.role === "user") return <div className="msg user">{item.text}</div>;
  if (item.role === "command") return <div className="msg user command">{item.text}</div>;
  // A pulse that ended: one line - what it was, how it ended, how long and what it cost - coloured by its kind, as the
  // work view colours it. A click opens it there, its report and its spec a click away: the chat stays a conversation.
  if (item.role === "job") {
    const kind = /\bconformance\b/.test(item.summary) ? "conformance" : "regenerate";
    return (
      <div className={`msg job-note ${kind} ${item.status}`}>
        <button className="job-note-head" onClick={() => onShowPulse?.(item.id)} title="open it in the work view">
          {item.status === "succeeded" ? <Icon name={kind === "conformance" ? "checks" : "check"} size={14} /> : item.status === "stopped" ? <Icon name="stop" size={14} /> : <Icon name="warn" size={14} />}
          <strong>{item.summary}</strong>
          <span className="muted">
            {item.status} · {item.duration}
            {item.spent ? ` · ${item.spent}` : ""}
          </span>
          <Icon name="chevron" size={12} />
        </button>
      </div>
    );
  }
  if (item.role === "note")
    return (
      <div className={`msg note ${item.level ?? ""} ${item.customType === "turri_command_echo" ? "echo" : ""}`}>
        <Prose text={item.text} />
      </div>
    );
  if (item.role !== "assistant") return null;
  return (
    <div className={`msg assistant ${live ? "live" : ""}`}>
      {item.thinking && (
        <button className="thinking-toggle" onClick={() => setThinking(!thinking)}>
          {thinking ? "hide thinking" : "thought about it"}
        </button>
      )}
      {thinking && item.thinking && <div className="thinking">{item.thinking}</div>}
      {item.text && <Prose text={item.text} />}
      {item.tools?.map((tool) => (
        <ToolCall key={tool.id} tool={tool} result={results.get(tool.id)} running={running.get(tool.id) === true} />
      ))}
      {item.error && <div className="msg-error">{item.error}</div>}
    </div>
  );
}

/** What a tool call says it does, in words: the turri tools by what they mean, the rest by name. */
function describeTool(name: string, args: any): string {
  const file = args?.path ?? args?.file ?? args?.plain_file ?? args?.plainFile;
  switch (name) {
    case "read":
      return `read ${file ?? "a file"}`;
    case "write":
      return `wrote ${file ?? "a file"}`;
    case "edit":
      return `edited ${file ?? "a file"}`;
    case "bash":
      return `ran ${String(args?.command ?? "a command").split("\n")[0]}`;
    case "ask_user":
      return `asked you: ${args?.question ?? ""}`;
    case "browser_navigate":
      return `opened ${args?.url ?? "the app"} in the preview`;
    case "browser_screenshot":
      return "looked at the preview";
    case "browser_read":
      return "read the preview";
    case "browser_console":
      return "read the preview's console";
    case "browser_click":
      return `clicked ${args?.ref !== undefined ? `[${args.ref}]` : (args?.selector ?? "")} in the preview`;
    case "browser_type":
      return `typed "${args?.text ?? ""}" in the preview`;
    default:
      return `${name.replace(/_/g, " ")}${file ? ` · ${file}` : ""}`;
  }
}

function ToolCall({ tool, result, running }: { tool: { id: string; name: string; args: unknown }; result?: Extract<ChatItem, { role: "toolResult" }>; running: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-call ${result?.isError ? "error" : ""}`}>
      <button onClick={() => setOpen(!open)}>
        {running ? <Spinner /> : result?.isError ? <Icon name="warn" size={13} /> : <Icon name="check" size={13} />}
        <span>{describeTool(tool.name, tool.args)}</span>
      </button>
      {open && (
        <div className="tool-detail">
          <pre>{JSON.stringify(tool.args, null, 2)}</pre>
          {result?.image && <img className="tool-image" src={result.image} alt="what turri saw in the preview" />}
          {result && <pre className="tool-result">{result.text}</pre>}
        </div>
      )}
    </div>
  );
}

/**
 * What turri says, as the Markdown it is written in - paragraphs, lists, headings, tables, code, links, and its
 * escapes: an escaped ***plain shows as ***plain. Raw HTML in it is shown as text, never run in the window; a link opens
 * in the browser.
 */
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const linkOpen = markdown.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index]!.attrSet("target", "_blank");
  tokens[index]!.attrSet("rel", "noreferrer");
  return linkOpen(tokens, index, options, env, self);
};

export function Prose({ text }: { text: string }) {
  const html = useMemo(() => markdown.render(text), [text]);
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** turri asking: a sheet over the window, as a native app asks - options to pick, or words to type. */
/**
 * A skill's phases, above the message box while it runs - brood's intent, stack, testing and product: the ones done
 * ticked, the one it is in turning, the rest to come, joined by a line filled as far as it has got; and under them
 * what the phase it is in does.
 */
function ProgressBar({ progress }: { progress: SkillProgress }) {
  const current = progress.phases.find((phase) => phase.state === "now")?.name;
  // "stack - the language, ..." under a bar that already says stack: what it does, alone.
  const about = progress.about && current && progress.about.startsWith(`${current} - `) ? progress.about.slice(current.length + 3) : progress.about;
  return (
    <div className="skill-progress" role="status" aria-label={`${progress.skill}${progress.where ? `, ${progress.where}` : ""}`}>
      <div className="skill-progress-head">
        <strong>{progress.skill}</strong>
        {progress.phases.length === 0 && <Spinner />}
        {progress.where && <span className="muted">{progress.where}</span>}
      </div>
      {progress.phases.length > 0 && (
        <ol className="skill-phases">
          {progress.phases.map((phase) => (
            <li key={phase.name} className={phase.state}>
              <span className="skill-phase-mark">{phase.state === "done" ? <Icon name="check" size={12} /> : phase.state === "now" ? <Spinner /> : null}</span>
              <span className="skill-phase-name">{phase.name}</span>
            </li>
          ))}
        </ol>
      )}
      {about && (
        <p className="skill-about">
          {current && <strong>{current}</strong>} {about}
        </p>
      )}
    </div>
  );
}

/**
 * A question of turri's, docked at the foot of the chat in the message box's place: the conversation stays in view
 * above it, and the window is not covered. Its options are buttons; an answer of one's own is typed in it.
 */
/**
 * The question asked now - or, for a moment after it is answered, the one answered: turri asks again at once when there
 * is more to choose (another box to tick), and the card stays put for it rather than giving way to the message box
 * and coming back.
 */
function useLingering(question: Question | undefined): Question | undefined {
  const [held, setHeld] = useState(question);
  useEffect(() => {
    if (question !== undefined) {
      setHeld(question);
      return;
    }
    const timer = setTimeout(() => setHeld(undefined), 400);
    return () => clearTimeout(timer);
  }, [question]);
  return question ?? held;
}

/** turri's boxes: a question of several answers is asked again after each one, its options ticked and unticked. */
const BOX = /^([☑☐]) ([\s\S]*)$/;

function QuestionCard({ question, waiting, onAnswer }: { question: Question; waiting: boolean; onAnswer: (value: unknown) => void }) {
  const [text, setText] = useState(question.prefill ?? "");
  // The box just clicked: shown ticked or unticked at once, before turri asks again with it so.
  const [toggled, setToggled] = useState<string | null>(null);
  useEffect(() => setToggled(null), [question.id]);
  const [other, setOther] = useState(question.kind === "input" || question.kind === "editor" || (question.kind === "question" && !question.options?.length));
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (other) field.current?.focus();
  }, [other]);
  const options = question.options ?? [];
  // A question of boxes: its rows are boxes, and its last option - Done - is the card's button.
  const boxes = options.some((option) => BOX.test(option));
  const done = boxes ? options.findLast((option) => !BOX.test(option) && option.startsWith("Done")) : undefined;
  const answer = (value: unknown) => {
    if (!waiting) onAnswer(value);
  };
  return (
    <div className={`question-card ${waiting ? "waiting" : ""}`} role="dialog" aria-label={question.title}>
      <div className="question-scroll">
        <div className="question-asks">
          <Jellyfish size={16} swimming={false} /> turri asks
        </div>
        <h2>{question.title}</h2>
        {question.message && (
          <div className="question-context">
            <Prose text={question.message} />
          </div>
        )}
        {question.kind === "confirm" ? (
          <div className="sheet-actions">
            <button className="button small" onClick={() => onAnswer(false)}>
              no
            </button>
            <button className="button small primary" onClick={() => onAnswer(true)} autoFocus>
              yes
            </button>
          </div>
        ) : (
          <>
            {options.length > 0 && (
              <div className="options">
                {options.map((option) => {
                  if (option === done) return null;
                  const box = BOX.exec(option);
                  if (box === null)
                    return (
                      <button key={option} className="option" onClick={() => answer(option)}>
                        {option}
                      </button>
                    );
                  const label = box[2]!;
                  const ticked = (box[1] === "☑") !== (toggled === label);
                  return (
                    <button
                      key={label}
                      className={`option check ${ticked ? "on" : ""}`}
                      role="checkbox"
                      aria-checked={ticked}
                      onClick={() => {
                        if (waiting) return;
                        setToggled(label);
                        onAnswer(option);
                      }}
                    >
                      <span className="checkbox">{ticked && <Icon name="check" size={12} />}</span>
                      {label}
                    </button>
                  );
                })}
                {question.kind === "question" && !other && (
                  <button className="option muted" onClick={() => setOther(true)}>
                    something else…
                  </button>
                )}
              </div>
            )}
            {other && (
              <textarea
                ref={field}
                className="answer"
                rows={question.kind === "editor" ? 10 : 3}
                placeholder={question.placeholder ?? "your answer"}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && question.kind !== "editor") {
                    event.preventDefault();
                    if (text.trim()) onAnswer(text.trim());
                  }
                }}
              />
            )}
            <div className="sheet-actions">
              <button className="button small" onClick={() => onAnswer(undefined)}>
                skip
              </button>
              {done && !other && (
                <button className="button small primary" onClick={() => answer(done)}>
                  done
                </button>
              )}
              {other && (
                <button className="button small primary" disabled={!text.trim()} onClick={() => onAnswer(text.trim())}>
                  Answer {question.kind !== "editor" && <kbd>↩</kbd>}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A new session is asked for: a native menu says what it does, and choosing it is the yes. */
async function newSession(props: { onNewSession: () => void }) {
  const chosen = await window.turri.popup([
    { id: "new", label: "start a new session - forget this conversation" },
    { type: "separator" },
    { id: "keep", label: "keep this one" },
  ]);
  if (chosen === "new") props.onNewSession();
}

/** The context the conversation fills - a ring, and its percent - and what its model has cost so far. */
function ChatMeter({ stats }: { stats: ChatStats }) {
  const percent = stats.percent === null ? null : Math.min(100, Math.max(0, stats.percent));
  const tone = percent === null ? "" : percent >= 85 ? "full" : percent >= 60 ? "filling" : "";
  const thousands = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const context =
    percent === null
      ? "context: not known yet - it is measured at the next reply"
      : `context: ${stats.tokens !== null ? thousands(stats.tokens) : "?"} of ${stats.contextWindow !== null ? thousands(stats.contextWindow) : "?"} tokens (${Math.round(percent)}%)`;
  const title = `${context}\nthis conversation has cost $${stats.cost.toFixed(2)} so far - its own model's calls; the pulses' cost is in the work view.`;
  const r = 6;
  const around = 2 * Math.PI * r;
  return (
    <span className={`chat-meter ${tone}`} title={title}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r={r} className="chat-meter-track" />
        <circle cx="8" cy="8" r={r} className="chat-meter-fill" strokeDasharray={`${((percent ?? 0) / 100) * around} ${around}`} transform="rotate(-90 8 8)" />
      </svg>
      <span>{percent === null ? "–" : `${Math.round(percent)}%`}</span>
      <span className="chat-meter-cost">${stats.cost.toFixed(2)}</span>
    </span>
  );
}
