import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./types.ts";
import type { Concept, Job, Pane, PastRun, Project, Spec, Status, View } from "./types.ts";
import { Welcome } from "./Welcome.tsx";
import { SpecView } from "./SpecView.tsx";
import { WorkView } from "./WorkView.tsx";
import { PlanSheet, type Plan } from "./PlanSheet.tsx";
import { DoctorSheet, problems, toSeeTo } from "./DoctorSheet.tsx";
import { AuthSheet } from "./AuthSheet.tsx";
import { AboutSheet, type AboutTab } from "./AboutSheet.tsx";
import { SettingsSheet } from "./SettingsSheet.tsx";
import { ProjectSettingsSheet } from "./ProjectSettings.tsx";
import { GettingStartedSheet } from "./GettingStarted.tsx";
import type { Check } from "../electron/preload.ts";
import { RegenerateSheet, type Regeneration } from "./RegenerateSheet.tsx";
import { NewProject } from "./NewProject.tsx";
import { ProjectSwitcher } from "./ProjectSwitcher.tsx";
import { FileTree } from "./FileTree.tsx";
import { FileView } from "./FileView.tsx";
import { PreviewView, savedPane, savePane } from "./PreviewView.tsx";
import { StdlibView } from "./StdlibView.tsx";
import { ConceptUses, type Followed, type Link, type Place, type Use } from "./PlainLinks.tsx";
import { Empty, Icon, Jellyfish, PlainName, Spinner, TurriVersionLine, withPlain } from "./ui.tsx";
import { Chat, type ChatItem, type ChatStats, type Question, type SkillProgress } from "./Chat.tsx";
import { keys } from "./platform.ts";

const EMPTY_STATUS: Status = { modules: [], jobs: [], planned: [] };

/** The chat's width: dragged by its edge, kept between launches, never so wide the spec has no room. */
const CHAT_WIDTH = 400;
const CHAT_MIN = 300;
const CHAT_KEY = "turri-app.chat-width";
/** The files' width: dragged by their edge as the chat's is, kept between launches. */
const FILES_WIDTH = 260;
const FILES_MIN = 180;
const FILES_KEY = "turri-app.files-width";
/** The room the ***plain keeps between the files and the chat, however wide either is dragged. */
const SPEC_MIN = 480;
/** The chat's width, beside files `files` wide - 0 when they are hidden. */
function clampChat(width: number, files: number) {
  return Math.round(Math.max(CHAT_MIN, Math.min(width, window.innerWidth - files - SPEC_MIN)));
}
/** The files' width, beside a chat `chat` wide - 0 when it is hidden. */
function clampFiles(width: number, chat: number) {
  return Math.round(Math.max(FILES_MIN, Math.min(width, window.innerWidth - chat - SPEC_MIN)));
}
function savedFilesWidth() {
  try {
    const saved = Number(localStorage.getItem(FILES_KEY));
    return saved > 0 ? saved : FILES_WIDTH;
  } catch {
    return FILES_WIDTH;
  }
}
const SIDEBAR_KEY = "turri-app.sidebar";
/** Whether the files' sidebar is shown: hidden with ⌘B, and kept hidden next time. */
function savedSidebar() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "hidden";
  } catch {
    return true;
  }
}
function savedChatWidth() {
  try {
    const saved = Number(localStorage.getItem(CHAT_KEY));
    return saved > 0 ? saved : CHAT_WIDTH;
  } catch {
    return CHAT_WIDTH;
  }
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("spec");
  const [pane, setPane] = useState<Pane>("browser");
  /** The standard library's template open in the stdlib view: kept as the person goes to another view and back. */
  const [template, setTemplate] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(EMPTY_STATUS);
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  /** Earlier sessions' pulses, from the ledger: read when the project opens and again as each pulse ends. */
  const [earlier, setEarlier] = useState<PastRun[]>([]);
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [plan, setPlan] = useState<Plan | "loading" | null>(null);
  // Whether this machine is ready for turri: the sheet of turri doctor's checks, and what they found as the project opened.
  // Open, and whether it asks the models from the start: a project just started does, to see that its models answer.
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorModels, setDoctorModels] = useState(false);
  const [machine, setMachine] = useState<Check[] | null>(null);
  // Signing in to the model providers: the sheet, open on a provider when one was named - /login anthropic.
  const [signIn, setSignIn] = useState<{ provider: string | null } | null>(null);
  // The app's settings (⌘,), About on one of its tabs - privacy, the third-party notices - and Help > Getting Started.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [about, setAbout] = useState<AboutTab | null>(null);
  const [guide, setGuide] = useState(false);
  // Regenerate, chosen how - open with the functional specs it starts on, if any.
  const [choosing, setChoosing] = useState<string[] | null>(null);
  // Lines of a spec to bring into view and light: a pulse's part of it, shown from the work.
  const [reveal, setReveal] = useState<{ file: string; lines: number[]; texts?: string[]; at: number } | null>(null);
  // Lit once, where it was asked for: gone as the person looks elsewhere - another view, file or template - so coming back
  // lights nothing again.
  useEffect(() => {
    if (reveal === null) return;
    const there = view === "stdlib" ? template === reveal.file : view === "spec" && selected === reveal.file;
    if (!there) setReveal(null);
  }, [view, selected, template, reveal]);
  // A pulse to open in the work view: one the chat says ended, clicked there.
  const [focusPulse, setFocusPulse] = useState<{ id: string; at: number } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  // The conversation with turri.
  const [chatOpen, setChatOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  /** The open-projects switcher (⇧⌘P), dropped over the window. */
  const [switcher, setSwitcher] = useState(false);
  /** Another project, being opened: the one shown waits under a spinner, as its engine has already stopped. */
  const [switching, setSwitching] = useState<{ dir: string; name: string } | null>(null);
  const [chatWidth, setChatWidth] = useState(savedChatWidth);
  const [filesWidth, setFilesWidth] = useState(savedFilesWidth);
  useEffect(() => {
    try {
      localStorage.setItem(FILES_KEY, String(filesWidth));
    } catch {
      /* not kept: it is 260 again next time */
    }
  }, [filesWidth]);
  const [sidebarOpen, setSidebarOpen] = useState(savedSidebar);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? "shown" : "hidden");
    } catch {
      /* not kept: it is shown again next time */
    }
  }, [sidebarOpen]);
  const [resizing, setResizing] = useState(false);
  // The window resized: the files' and the chat's widths are held to it again.
  const [, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resized = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, String(chatWidth));
    } catch {
      /* not kept: it is 400 again next time */
    }
  }, [chatWidth]);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState<ChatItem | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [toolsRunning, setToolsRunning] = useState<Map<string, boolean>>(new Map());
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  // The skill running in the chat - brood, spawn - and where it is in its phases.
  const [progress, setProgress] = useState<SkillProgress | null>(null);
  const [chatModel, setChatModel] = useState<string | null>(null);
  const [chatStats, setChatStats] = useState<ChatStats | null>(null);
  const [commands, setCommands] = useState<Array<{ name: string; description: string }>>([]);
  /** The concepts the project's ***plain can name, for the chat to offer as one is typed: read again as a .plain changes. */
  const [concepts, setConcepts] = useState<Concept[]>([]);
  useEffect(() => {
    if (project === null || !project.offers.concepts) return setConcepts([]);
    const read = () => void window.turri.call<Concept[]>("concepts").then(setConcepts, () => {});
    read();
    const offFiles = window.turri.on("engine:files", ({ paths }: { paths: string[] }) => paths.some((path) => path.endsWith(".plain")) && read());
    const offSpec = window.turri.on("engine:spec", read);
    return () => (offFiles(), offSpec());
  }, [project?.dir]);

  // What is selected in the tree: one of the project's specs, or any other file of it.
  const spec = project?.specs.find((entry) => entry.file === selected) ?? null;
  const file = spec === null && project !== null && selected !== null ? selected : null;

  const say = useCallback((text: string, tone: "info" | "error" = "info") => {
    setToast({ text, tone });
    setTimeout(() => setToast((now) => (now?.text === text ? null : now)), tone === "error" ? 9000 : 4500);
  }, []);

  const refreshProject = useCallback(async () => {
    const summary = await window.turri.call<Omit<Project, never>>("summary");
    setProject(summary);
  }, []);

  const opened = useCallback((summary: Project | null) => {
    if (summary === null) return;
    setSwitching(null);
    setGuide(false);
    setProject(summary);
    setSelected(summary.specs[0]?.file ?? null);
    setTemplate(null);
    setStatus(EMPTY_STATUS);
    setJobs(new Map());
    setEarlier([]);
    void window.turri.call<PastRun[]>("earlierPulses").then(setEarlier);
    setView("spec");
    setPane(savedPane(summary.dir));
    setStreaming(null);
    setQuestions([]);
    setProgress(null);
    void window.turri.call<{ messages: ChatItem[]; model: string | null; stats: ChatStats }>("chatHistory").then(({ messages, model, stats }) => {
      setChatStats(stats);
      // A project just started opens on what turri said of its config: its models, and how to sign in to them.
      setItems(summary.setup ? [...messages, { role: "note", text: summary.setup, level: "info" }] : messages);
      setChatModel(model);
    });
    // Its models just chosen and its config written: whether this machine is ready for it, and the models answer.
    if (summary.setup) {
      setDoctorModels(true);
      setDoctorOpen(true);
    }
    void window.turri.call<Array<{ name: string; description: string }>>("commands").then(setCommands);
  }, []);

  // What the engine says as the work goes on.
  useEffect(() => {
    const off = [
      window.turri.on("engine:job", (job: Job) => setJobs((all) => new Map(all).set(job.id, job))),
      window.turri.on("engine:status", (next: Status) => {
        setStatus(next);
        setJobs(new Map(next.jobs.map((job) => [job.id, job])));
      }),
      window.turri.on("engine:finished", (done: { status: string; title: string; module?: string }) => {
        say(`${done.module ?? "job"} - ${done.title}: ${done.status}`, done.status === "failed" ? "error" : "info");
        void refreshProject();
      }),
      window.turri.on("engine:earlier", (runs: PastRun[]) => setEarlier(runs)),
      window.turri.on("engine:incident", (incident: { job?: string; text: string }) => say(incident.text, "error")),
      window.turri.on("engine:exit", () => say("the turri engine stopped. open the project again to restart it.", "error")),
      window.turri.on("project:opened", opened),
      window.turri.on("project:opening", setSwitching),
      window.turri.on("project:failed", ({ text }: { text: string }) => say(text, "error")),
      // A .plain file changed on disk - turri edited it, say: what it says now, in the sidebar; a new one, listed.
      window.turri.on("engine:spec", ({ spec: next }: { spec: Spec }) =>
        setProject((now) => {
          if (now === null) return now;
          if (!now.specs.some((entry) => entry.file === next.file)) {
            void refreshProject();
            return now;
          }
          return { ...now, specs: now.specs.map((entry) => (entry.file === next.file ? next : entry)) };
        }),
      ),
      window.turri.on("engine:chat:message", (item: ChatItem) => setItems((all) => [...all, item])),
      window.turri.on("engine:chat:streaming", (item: ChatItem | null) => setStreaming(item)),
      window.turri.on("engine:chat:busy", ({ busy }: { busy: boolean }) => {
        setChatBusy(busy);
        if (!busy) setWorking(null);
      }),
      window.turri.on("engine:chat:working", ({ text }: { text: string | null }) => setWorking(text)),
      window.turri.on("engine:chat:tool", ({ id, running }: { id: string; running: boolean }) => setToolsRunning((all) => new Map(all).set(id, running))),
      window.turri.on("engine:chat:status", ({ key, text }: { key: string; text: string | null }) => setStatuses((all) => ({ ...all, [key]: text ?? "" }))),
      window.turri.on("engine:chat:notify", ({ level, text }: { level: string; text: string }) => {
        setItems((all) => [...all, { role: "note", text, level }]);
        if (level === "error") say(text.split("\n")[0]!, "error");
      }),
      window.turri.on("engine:chat:progress", (next: SkillProgress | null) => setProgress(next)),
      // The config changed - /turri-config, say: its settings in the sidebar, and the model the chat runs on now.
      window.turri.on("engine:config", () => void refreshProject()),
      window.turri.on("engine:chat:model", ({ model }: { model: string }) => setChatModel(model)),
      window.turri.on("engine:chat:stats", (stats: ChatStats) => setChatStats(stats)),
      // turri works in the preview with its browser tools: the window shows it, so the person sees what it does.
      window.turri.on("preview:reveal", () => (setView("preview"), setPane("browser"))),
      window.turri.on("terminal:reveal", () => (setView("preview"), setPane("terminal"))),
      // /login typed in the chat: pi's terminal would sign in there, the window does it in its sheet.
      window.turri.on("engine:auth:open", ({ provider }: { provider: string | null }) => setSignIn({ provider })),
      window.turri.on("engine:chat:ask", (question: Question) => {
        setQuestions((all) => [...all, question]);
        setChatOpen(true);
      }),
    ];
    return () => off.forEach((stop) => stop());
  }, [opened, refreshProject, say]);

  const regenerate = useCallback(
    async (how?: Regeneration) => {
      if (spec === null) return;
      if (dirty) await saveRef.current?.();
      setBusy(true);
      setChatOpen(true);
      try {
        await window.turri.call("regenerate", {
          file: spec.file,
          frids: how?.how === "again" ? how.frids : undefined,
          scratch: how?.how === "scratch",
          chain: how?.how === "scratch" && how.chain,
          // Continued: what changed, as turri brings a module up to its spec - with the planner told where it stopped.
          guidance:
            how?.how === "continue"
              ? `carry on where it stopped: build the functional specs not built yet - ${how.left.join(", ")}${how.guidance ? `. ${how.guidance}` : ""}`
              : how?.guidance,
        });
      } catch (error) {
        say(String((error as Error).message ?? error), "error");
      } finally {
        setBusy(false);
      }
    },
    [spec, dirty, say],
  );

  const conform = useCallback(
    async (frids?: string[]) => {
      if (spec === null) return;
      setBusy(true);
      setChatOpen(true);
      try {
        await window.turri.call("conform", { file: spec.file, frids });
      } catch (error) {
        say(String((error as Error).message ?? error), "error");
      } finally {
        setBusy(false);
      }
    },
    [spec, say],
  );

  // Something is built: there is a commit to release.
  const releasable = spec !== null && spec.ok && (spec.built === true || spec.functionalSpecs.some((entry) => entry.built));

  const release = useCallback(async () => {
    if (spec === null || !releasable) return;
    setChatOpen(true);
    try {
      await window.turri.call("release", { file: spec.file });
    } catch (error) {
      say(String((error as Error).message ?? error), "error");
    }
  }, [spec, releasable, say]);

  const glimpse = useCallback(async () => {
    if (spec === null) return;
    if (dirty) await saveRef.current?.();
    setPlan("loading");
    try {
      setPlan({ spec, ...(await window.turri.call<Omit<Plan, "spec">>("glimpse", { file: spec.file })) });
    } catch (error) {
      setPlan(null);
      say(String((error as Error).message ?? error), "error");
    }
  }, [spec, dirty, say]);

  // The native menu's commands.
  useEffect(
    () =>
      window.turri.on("menu", (action: string) => {
        if (action.startsWith("view:")) setView(action.slice(5) as View);
        else if (action === "regenerate-how" && spec?.ok) setChoosing([]);
        else if (action === "regenerate") void regenerate();
        else if (action === "glimpse") void glimpse();
        else if (action === "conform") void conform();
        else if (action === "release") void release();
        else if (action === "save") void saveRef.current?.();
        else if (action === "new-project") setCreating(true);
        else if (action === "switch-project") setSwitcher((open) => !open);
        else if (action === "chat") setChatOpen((open) => !open);
        else if (action === "sidebar") setSidebarOpen((open) => !open);
        // ⌘R, as in a browser: in the preview the page being tried - the terminal is not reloaded - else the window,
        // which is given its project back.
        else if (action === "reload") {
          if (view !== "preview") location.reload();
          else if (pane === "browser") void window.turri.preview.go("reload");
        }
        else if (action === "reveal" && project) void window.turri.reveal(project.dir);
        else if (action === "doctor") (setDoctorModels(false), setDoctorOpen(true));
        else if (action === "sign-in") setSignIn({ provider: null });
        else if (action === "settings") setSettingsOpen(true);
        else if (action === "project-settings") setProjectSettingsOpen(true);
        else if (action === "about" || action === "privacy" || action === "notices") setAbout(action);
        else if (action === "getting-started") setGuide(true);
      }),
    [regenerate, glimpse, conform, release, project, spec, view, pane],
  );

  // What the person is looking at, for turri to know: the view, and the file open in it - or the preview's browser or terminal.
  useEffect(() => {
    if (project === null) return;
    void window.turri.call("look", { view, file: view === "spec" ? selected : view === "stdlib" ? template : null, pane: view === "preview" ? pane : null }).catch(() => {});
  }, [project?.dir, view, selected, pane, template]);
  useEffect(() => {
    if (project !== null) savePane(project.dir, pane);
  }, [project?.dir, pane]);

  // What the project needs of this machine - its toolchains, what its testing scripts run - checked as it opens, the
  // models not asked: anything missing is said at the foot of the sidebar.
  useEffect(() => {
    setMachine(null);
    if (project === null) return;
    void window.turri.doctor().then(setMachine).catch(() => {});
  }, [project?.dir]);

  // The stdlib view only where the turri running gives the window its standard library: intent otherwise.
  useEffect(() => {
    if (view === "stdlib" && project !== null && !project.offers.stdlib) setView("spec");
  }, [view, project]);

  /** A module a ***plain names, or one that names it: the standard library's in the stdlib view, the project's in intent. */
  /** A place in the ***plain opened, its line in view and lit: a template of the standard library in stdlib, the project's in intent. */
  const showAt = useCallback((where: Place) => {
    const lit = { lines: [where.line], at: Date.now() };
    if (where.stdlib) {
      setTemplate(where.module);
      setReveal({ file: where.module, ...lit });
      setView("stdlib");
    } else {
      setSelected(where.file);
      setReveal({ file: where.file, ...lit });
      setView("spec");
    }
  }, []);

  /** Where a concept ⌘-clicked where it is defined is used - at the point clicked - to go to one. */
  const [uses, setUses] = useState<{ concept: string; uses: Use[]; x: number; y: number } | null>(null);

  /**
   * A concept clicked in the chat, or ⌘-clicked on a line of a .plain - `from` - opened where it is defined, as turri's
   * graph has it: from a line, the definition that line's item names. ⌘-clicked where it is defined, where it is used.
   */
  const showConcept = useCallback(
    async (concept: string, from?: { file: string; line: number; x: number; y: number }) => {
      const where = await window.turri
        .call<(Place & { uses?: Use[] }) | { plain: true } | null>("conceptDefinition", { concept, file: from?.file, line: from?.line })
        .catch(() => null);
      if (where === null) return say(`no ***plain file of the project defines ${concept}.`);
      if ("plain" in where) return say(`${concept} is ***plain's own: no ***plain file defines it.`);
      if (where.uses === undefined) return showAt(where);
      if (where.uses.length === 0) return say(`no ***plain file uses ${concept} yet.`);
      setUses({ concept, uses: where.uses, x: from!.x, y: from!.y });
    },
    [say, showAt],
  );

  const openLink = useCallback((link: Link) => {
    if (link.stdlib) setTemplate(link.name);
    else if (link.file !== null) setSelected(link.file);
    else return;
    setView(link.stdlib ? "stdlib" : "spec");
  }, []);

  /** What is ⌘-clicked in a .plain of the project: the module it names, a concept's definition, a linked resource's file. */
  const follow = useCallback(
    async (file: string, followed: Followed, point: { x: number; y: number }) => {
      if ("module" in followed) return openLink(followed.module);
      if ("concept" in followed) return showConcept(followed.concept, { file, line: followed.line, ...point });
      const resource = await window.turri.call<{ file: string } | { missing: string } | null>("linkedResource", { file, line: followed.line, index: followed.resource }).catch(() => null);
      if (resource === null) return;
      if ("missing" in resource) return say(`${resource.missing} is not in the project.`);
      setSelected(resource.file);
      setView("spec");
    },
    [openLink, showConcept, say],
  );

  const allJobs = useMemo(() => [...jobs.values()].sort((a, b) => b.sequence - a.sequence), [jobs]);
  const runningFor = (module: string) => allJobs.find((job) => job.module === module && job.status === "running");
  const running = allJobs.filter((job) => job.status === "running");

  // In the same place whether a project is open or not, so it is not made again when one opens under it.
  const newProject = creating && <NewProject onOpened={opened} onDone={() => setCreating(false)} />;
  const projectSwitcher = switcher && <ProjectSwitcher onClose={() => setSwitcher(false)} />;
  const doctorSheet = doctorOpen && (
    <DoctorSheet
      project={project?.name ?? null}
      askModels={doctorModels}
      onClose={() => {
        setDoctorOpen(false);
        // What was seen to while it was open shows at once at the foot of the sidebar.
        if (project !== null) void window.turri.doctor().then(setMachine).catch(() => {});
      }}
    />
  );
  const authSheet = signIn !== null && (
    <AuthSheet
      dir={project?.dir}
      initial={signIn.provider}
      onClose={() => {
        setSignIn(null);
        // Signed in: the foot of the sidebar says so at once.
        if (project !== null) void window.turri.doctor().then(setMachine).catch(() => {});
      }}
    />
  );
  const settingsSheet = settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} onPrivacy={() => (setSettingsOpen(false), setAbout("privacy"))} />;
  const projectSettingsSheet = projectSettingsOpen && project !== null && (
    <ProjectSettingsSheet
      settings={project.settings}
      onClose={() => setProjectSettingsOpen(false)}
      onOpenFile={() => {
        setProjectSettingsOpen(false);
        setSelected(`${project.dir}/config.turri.yaml`);
        setView("spec");
      }}
    />
  );
  const aboutSheet = about !== null && <AboutSheet tab={about} onClose={() => setAbout(null)} />;
  if (project === null)
    return (
      <>
        <Welcome guide={guide} onOpened={opened} onNew={() => setCreating(true)} onDoctor={() => (setDoctorModels(false), setDoctorOpen(true))} onSignIn={() => setSignIn({ provider: null })} />
        {newProject}
        {projectSwitcher}
        {doctorSheet}
        {authSheet}
        {settingsSheet}
        {aboutSheet}
      </>
    );

  // As wide as dragged, held to the window: the files first, then the chat beside them - the ***plain keeps its room.
  const filesShown = clampFiles(filesWidth, chatOpen ? CHAT_MIN : 0);
  const chatShown = clampChat(chatWidth, sidebarOpen ? filesShown : 0);

  return (
    <>
      <div
        className={`app ${chatOpen ? "with-chat" : ""} ${sidebarOpen ? "" : "no-sidebar"} ${resizing ? "resizing" : ""}`}
        style={{ "--chat-width": `${chatShown}px`, "--files-width": `${filesShown}px` } as React.CSSProperties}
        inert={switching !== null}
      >
        {sidebarOpen && (
          // The files' right edge: drag it to make them wider or thinner, double-click it for the width they start at.
          <div
            className="files-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="resize the files"
            title="drag to resize the files - double-click to reset"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) setFilesWidth(clampFiles(event.clientX, chatOpen ? chatShown : 0));
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setResizing(false);
            }}
            onDoubleClick={() => setFilesWidth(FILES_WIDTH)}
          />
        )}
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="project-name" title={project.dir}>
              <Jellyfish size={18} swimming={running.length > 0} />
              <span>{project.name}</span>
            </div>
            <div className="sidebar-section">files</div>
            <FileTree
              root={project.dir}
              specs={project.specs}
              selected={selected}
              isRunning={(module) => runningFor(module) !== undefined}
              onSelect={(path) => {
                setSelected(path);
                setView("spec");
              }}
            />
            <div className="sidebar-footer">
              {running.length > 0 ? (
                <button className="link" onClick={() => setView("work")}>
                  <Jellyfish size={22} /> {running.length} pulse{running.length === 1 ? "" : "s"} running
                </button>
              ) : (
                <span className="muted">idle</span>
              )}
              {problems(machine).length > 0 && (
                <button className="link machine-wanting" onClick={() => (setDoctorModels(false), setDoctorOpen(true))} title={problems(machine).map((check) => `${check.name}: ${check.detail}`).join("\n")}>
                  <Icon name="warn" size={12} /> {toSeeTo(problems(machine))}
                </button>
              )}
              <TurriVersionLine />
            </div>
          </aside>
        )}

        <main className={`main ${project?.offers.resources ? "follows-resources" : ""}`}>
          <header className="toolbar">
            <button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} title={`${sidebarOpen ? "hide" : "show"} the files (${keys("B")})`} aria-label={sidebarOpen ? "hide the files" : "show the files"} aria-pressed={sidebarOpen}>
              <Icon name="sidebar" />
            </button>
            <div className="segmented" role="tablist">
              {(["spec", "work", "preview", ...(project.offers.stdlib ? ["stdlib"] : [])] as View[]).map((name) => (
                <button key={name} role="tab" aria-selected={view === name} className={view === name ? "on" : ""} onClick={() => setView(name)}>
                  {name === "spec" ? "intent" : name === "work" ? `work${running.length ? ` · ${running.length}` : ""}` : name}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              {/* The project's settings - config.turri.yaml's - in a sheet, changed through /turri-config as the person would type
                  it: in the toolbar, there with the files hidden too. */}
              <button className="icon-button project-settings-button" onClick={() => setProjectSettingsOpen(true)} title="project settings - its models, conformance tests, review, pulses at once, debug" aria-label="project settings">
                <Icon name="gear" />
              </button>
              <button className="button" disabled={!releasable} onClick={() => void release()} title={releasable ? "release what is built to try, and hear from turri what to test" : "nothing is built yet: regenerate first"}>
                <Icon name="release" /> release
              </button>
              {/* Only turri halts a pulse: while one regenerates this module, Regenerate waits for it. */}
              <button
                className="button primary"
                disabled={spec === null || !spec.ok || busy || runningFor(spec.module) !== undefined}
                onClick={() => setChoosing([])}
                title={
                  spec && runningFor(spec.module)
                    ? "turri is regenerating this module"
                    : spec && !spec.functionalSpecs.some((entry) => entry.built)
                      ? "regenerate all of it - nothing is built yet"
                      : "regenerate - what changed, chosen functional specs, or from scratch"
                }
              >
                {busy || (spec && runningFor(spec.module)) ? <Spinner /> : <Icon name="play" />} regenerate…
              </button>
              {!chatOpen && (
                <button className={`button open-chat ${questions.length > 0 ? "asking" : ""}`} onClick={() => setChatOpen(true)} title={questions.length > 0 ? "turri is asking you something" : `talk to turri (${keys("J")})`}>
                  <Jellyfish size={16} swimming={false} /> turri{questions.length > 0 && " · asks"}
                </button>
              )}
            </div>
          </header>

          <section className="content">
            {view === "preview" ? (
              // A sheet over the window would be under the pane: while one is open, the pane steps aside.
              <PreviewView key={project.dir} dir={project.dir} covered={plan !== null || doctorOpen || signIn !== null || creating || choosing !== null || switching !== null || switcher || settingsOpen || projectSettingsOpen || about !== null || guide} pane={pane} onPane={setPane} />
            ) : view === "stdlib" ? (
              <StdlibView
                key={project.dir}
                selected={template}
                reveal={reveal !== null && reveal.file === template ? reveal : undefined}
                onSelect={setTemplate}
                onOpenSpec={(path) => {
                  setSelected(path);
                  setView("spec");
                }}
              />
            ) : view === "work" ? (
              <WorkView
                status={status}
                jobs={allJobs}
                earlier={earlier}
                focus={focusPulse}
                onShowInSpec={(rel, lines) => {
                  const shown = project.specs.find((entry) => entry.rel === rel);
                  if (shown === undefined) return say(`${rel} is not one of the project's ***plain files now.`, "error");
                  setSelected(shown.file);
                  setView("spec");
                  // Where the pulse's lines are now: the ***plain may have changed since it ran.
                  setReveal({ file: shown.file, lines: lines.map((each) => each.line), texts: lines.map((each) => each.text), at: Date.now() });
                }}
              />
            ) : file !== null ? (
              <FileView key={file} root={project.dir} file={file} reveal={reveal?.file === file ? reveal : undefined} onDirty={setDirty} saveRef={saveRef} say={say} onOpen={openLink} onFollow={(followed, point) => void follow(file, followed, point)} />
            ) : spec === null ? (
              project.specs.length === 0 && (
                <Empty icon="doc" title="no ***plain yet">
                  tell turri what you want to build. it writes the first <PlainName /> with you, then builds the code from it.
                </Empty>
              )
            ) : (
              <SpecView
                key={spec.file}
                spec={spec}
                running={runningFor(spec.module)}
                reveal={reveal?.file === spec.file ? reveal : undefined}
                onSaved={(next: Spec) => setProject((now) => now && { ...now, specs: now.specs.map((entry) => (entry.file === next.file ? next : entry)) })}
                onDirty={setDirty}
                saveRef={saveRef}
                onRegenerate={(frids) => void regenerate(frids?.length ? { how: "again", frids, guidance: "" } : undefined)}
                onConform={(frids) => void conform(frids)}
                onOpen={openLink}
                onFollow={(followed, point) => void follow(spec.file, followed, point)}
                say={say}
              />
            )}
          </section>
          {uses !== null && (
            <ConceptUses
              {...uses}
              onGo={(use) => {
                setUses(null);
                showAt(use);
              }}
              onClose={() => setUses(null)}
            />
          )}
        </main>

        {chatOpen && (
          // The chat's left edge: drag it to make the chat wider or thinner, double-click it for the width it starts at.
          <div
            className="chat-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="resize the chat"
            title="drag to resize the chat - double-click to reset"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) setChatWidth(clampChat(window.innerWidth - event.clientX, sidebarOpen ? filesShown : 0));
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              setResizing(false);
            }}
            onDoubleClick={() => setChatWidth(CHAT_WIDTH)}
          />
        )}
        {chatOpen && (
          <Chat
            items={items}
            streaming={streaming}
            busy={chatBusy}
            working={working}
            running={toolsRunning}
            statuses={statuses}
            model={chatModel}
            fresh={project.specs.length === 0}
            commands={commands}
            concepts={concepts}
            onSend={(text) => void window.turri.call("sendChat", { text })}
            onAbort={() => void window.turri.call("abortChat")}
            onClose={() => setChatOpen(false)}
            question={questions[0]}
            progress={progress}
            stats={chatStats}
            newSessionBlocked={running.length > 0 ? `${running.length} pulse${running.length === 1 ? " is" : "s are"} running: start a new session once ${running.length === 1 ? "it has" : "they have"} finished` : null}
            onShowConcept={(concept) => void showConcept(concept)}
            onShowPulse={(id) => {
              if (!jobs.has(id) && !earlier.some((run) => run.pulses.some((pulse) => pulse.id === id))) return say("that pulse ran in an earlier session, and the ledger has nothing of it now.");
              setView("work");
              setFocusPulse({ id, at: Date.now() });
            }}
            onNewSession={() =>
              void window.turri
                .call<{ messages: ChatItem[]; model: string | null; stats: ChatStats }>("newChat")
                .then(({ messages, model, stats }) => {
                  setItems(messages);
                  setChatModel(model);
                  setChatStats(stats);
                  setStreaming(null);
                  setQuestions([]);
                  setProgress(null);
                  setWorking(null);
                  setStatuses({});
                  setToolsRunning(new Map());
                  setChatBusy(false);
                  say("A new session: turri starts with nothing of the last conversation.");
                })
                .catch((error) => say(String((error as Error).message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "error"))
            }
            onAnswer={(value) => {
              void window.turri.call("answer", { id: questions[0]!.id, value });
              setQuestions((all) => all.slice(1));
            }}
          />
        )}
        {choosing !== null && spec !== null && (
          <RegenerateSheet
            spec={spec}
            initial={choosing}
            onClose={() => setChoosing(null)}
            onRegenerate={(how) => {
              setChoosing(null);
              void regenerate(how);
            }}
          />
        )}
        {plan !== null && plan !== "loading" && <PlanSheet plan={plan} onClose={() => setPlan(null)} onRegenerate={() => (setPlan(null), void regenerate())} />}
        {toast && (
          <div className={`toast ${toast.tone}`} onClick={() => setToast(null)}>
            {toast.tone === "error" && <Icon name="warn" />}
            {withPlain(toast.text)}
          </div>
        )}
      </div>
      {switching !== null && (
        <div className="switching" role="status">
          <Spinner /> opening {switching.name}…
        </div>
      )}
      {guide && (
        <GettingStartedSheet
          onSignIn={() => setSignIn({ provider: null })}
          onNew={() => (setGuide(false), setCreating(true))}
          onDoctor={() => (setDoctorModels(false), setDoctorOpen(true))}
          onClose={() => setGuide(false)}
        />
      )}
      {newProject}
      {projectSwitcher}
      {doctorSheet}
      {authSheet}
      {settingsSheet}
      {projectSettingsSheet}
      {aboutSheet}
    </>
  );
}
