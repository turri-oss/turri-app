import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./types.ts";
import type { Job, Project, Spec, Status, View } from "./types.ts";
import { Welcome } from "./Welcome.tsx";
import { SpecView } from "./SpecView.tsx";
import { WorkView } from "./WorkView.tsx";
import { PlanSheet, type Plan } from "./PlanSheet.tsx";
import { Appearance, Icon, Jellyfish, Spinner } from "./ui.tsx";
import { Chat, QuestionSheet, type ChatItem, type Question } from "./Chat.tsx";

const EMPTY_STATUS: Status = { modules: [], jobs: [], planned: [] };

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("spec");
  const [status, setStatus] = useState<Status>(EMPTY_STATUS);
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [plan, setPlan] = useState<Plan | "loading" | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  // The conversation with turri.
  const [chatOpen, setChatOpen] = useState(true);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState<ChatItem | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [toolsRunning, setToolsRunning] = useState<Map<string, boolean>>(new Map());
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [chatModel, setChatModel] = useState<string | null>(null);

  const spec = project?.specs.find((entry) => entry.file === selected) ?? null;

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
    setProject(summary);
    setSelected(summary.specs[0]?.file ?? null);
    setStatus(EMPTY_STATUS);
    setJobs(new Map());
    setView("spec");
    setStreaming(null);
    setQuestions([]);
    void window.turri.call<{ messages: ChatItem[]; model: string | null }>("chatHistory").then(({ messages, model }) => {
      setItems(messages);
      setChatModel(model);
    });
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
        say(`${done.module ?? "Job"} - ${done.title}: ${done.status}`, done.status === "failed" ? "error" : "info");
        void refreshProject();
      }),
      window.turri.on("engine:incident", (incident: { job?: string; text: string }) => say(incident.text, "error")),
      window.turri.on("engine:exit", () => say("The turri engine stopped. Open the project again to restart it.", "error")),
      window.turri.on("project:opened", opened),
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
      window.turri.on("engine:chat:ask", (question: Question) => {
        setQuestions((all) => [...all, question]);
        setChatOpen(true);
      }),
    ];
    return () => off.forEach((stop) => stop());
  }, [opened, refreshProject, say]);

  const regenerate = useCallback(
    async (frids?: string[]) => {
      if (spec === null) return;
      if (dirty) await saveRef.current?.();
      setBusy(true);
      setChatOpen(true);
      try {
        await window.turri.call("regenerate", { file: spec.file, frids });
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

  const halt = useCallback(async () => {
    if (spec === null) return;
    await window.turri.call("halt", { module: spec.module });
  }, [spec, say]);

  // The native menu's commands.
  useEffect(
    () =>
      window.turri.on("menu", (action: string) => {
        if (action.startsWith("view:")) setView(action.slice(5) as View);
        else if (action === "regenerate") void regenerate();
        else if (action === "glimpse") void glimpse();
        else if (action === "conform") void conform();
        else if (action === "halt") void halt();
        else if (action === "save") void saveRef.current?.();
        else if (action === "chat") setChatOpen((open) => !open);
        else if (action === "reveal" && project) void window.turri.reveal(project.dir);
      }),
    [regenerate, glimpse, conform, halt, project],
  );

  const allJobs = useMemo(() => [...jobs.values()].sort((a, b) => b.sequence - a.sequence), [jobs]);
  const runningFor = (module: string) => allJobs.find((job) => job.module === module && job.status === "running");
  const running = allJobs.filter((job) => job.status === "running");

  if (project === null) return <Welcome onOpened={opened} />;

  return (
    <div className={`app ${chatOpen ? "with-chat" : ""}`}>
      <aside className="sidebar">
        <div className="titlebar-space" />
        <div className="project-name" title={project.dir}>
          <Jellyfish size={18} swimming={running.length > 0} />
          <span>{project.name}</span>
        </div>
        <div className="sidebar-section">Specs</div>
        <nav>
          {project.specs.map((entry) => (
            <SpecRow key={entry.file} spec={entry} active={entry.file === selected} running={runningFor(entry.module) !== undefined} onClick={() => setSelected(entry.file)} />
          ))}
          {project.specs.length === 0 && <div className="sidebar-note">No .plain files in this folder yet.</div>}
        </nav>
        <div className="sidebar-section">Settings</div>
        <dl className="settings">
          {Object.entries(project.settings).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd title={String(value)}>{value === null ? "-" : String(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="sidebar-footer">
          {running.length > 0 ? (
            <button className="link" onClick={() => setView("work")}>
              <Jellyfish size={22} /> {running.length} pulse{running.length === 1 ? "" : "s"} running
            </button>
          ) : (
            <span className="muted">Idle</span>
          )}
          <Appearance />
        </div>
      </aside>

      <main className="main">
        <header className="toolbar">
          <div className="toolbar-title">
            <h1>{spec?.module ?? project.name}</h1>
            {spec?.description && <span className="subtitle">{spec.description}</span>}
          </div>
          <div className="segmented" role="tablist">
            {(["spec", "work"] as View[]).map((name) => (
              <button key={name} role="tab" aria-selected={view === name} className={view === name ? "on" : ""} onClick={() => setView(name)}>
                {name === "spec" ? "Spec" : `Work${running.length ? ` · ${running.length}` : ""}`}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            {!chatOpen && (
              <button className="button" onClick={() => setChatOpen(true)} title="Talk to turri (⌘J)">
                <Icon name="spark" /> turri
              </button>
            )}
            <button className="button" disabled={spec === null || !spec.ok || plan === "loading"} onClick={() => void glimpse()} title="Plan the work without starting it (⇧⌘P)">
              {plan === "loading" ? <Spinner /> : <Icon name="eye" />} Preview plan
            </button>
            {spec && runningFor(spec.module) ? (
              <button className="button danger" onClick={() => void halt()} title="Halt this module (⌘.)">
                <Icon name="stop" /> Halt
              </button>
            ) : (
              <button className="button primary" disabled={spec === null || !spec.ok || busy} onClick={() => void regenerate()} title="Regenerate the code from the spec (⌘R)">
                {busy ? <Spinner /> : <Icon name="play" />} Regenerate
              </button>
            )}
          </div>
        </header>

        <section className="content">
          {spec === null ? null : view === "spec" ? (
            <SpecView
              key={spec.file}
              spec={spec}
              running={runningFor(spec.module)}
              onSaved={(next: Spec) => setProject((now) => now && { ...now, specs: now.specs.map((entry) => (entry.file === next.file ? next : entry)) })}
              onDirty={setDirty}
              saveRef={saveRef}
              onRegenerate={(frids) => void regenerate(frids)}
              onConform={(frids) => void conform(frids)}
              say={say}
            />
          ) : (
            <WorkView status={status} jobs={allJobs} onStop={(id) => void window.turri.call("stop", { id })} />
          )}
        </section>
      </main>

      {chatOpen && (
        <Chat
          items={items}
          streaming={streaming}
          busy={chatBusy}
          working={working}
          running={toolsRunning}
          statuses={statuses}
          model={chatModel}
          onSend={(text) => void window.turri.call("sendChat", { text })}
          onAbort={() => void window.turri.call("abortChat")}
          onClose={() => setChatOpen(false)}
        />
      )}
      {questions[0] && (
        <QuestionSheet
          key={questions[0].id}
          question={questions[0]}
          onAnswer={(value) => {
            void window.turri.call("answer", { id: questions[0]!.id, value });
            setQuestions((all) => all.slice(1));
          }}
        />
      )}
      {plan !== null && plan !== "loading" && <PlanSheet plan={plan} onClose={() => setPlan(null)} onRegenerate={() => (setPlan(null), void regenerate())} />}
      {toast && (
        <div className={`toast ${toast.tone}`} onClick={() => setToast(null)}>
          {toast.tone === "error" && <Icon name="warn" />} {toast.text}
        </div>
      )}
    </div>
  );
}

function SpecRow({ spec, active, running, onClick }: { spec: Spec; active: boolean; running: boolean; onClick: () => void }) {
  const total = spec.functionalSpecs.length;
  const built = spec.functionalSpecs.filter((entry) => entry.built).length;
  const state = !spec.ok ? "error" : running ? "running" : total > 0 && built === total && !spec.drifted ? "done" : built > 0 ? "partial" : "new";
  const label = { error: "does not parse", running: "regenerating", done: "up to date", partial: "to regenerate", new: "not built" }[state];
  return (
    <button className={`spec-row ${active ? "active" : ""}`} onClick={onClick} title={`${spec.rel} - ${label}`}>
      <span className={`state-dot ${state}`}>{state === "running" ? <Spinner /> : null}</span>
      <span className="spec-row-name">{spec.module}</span>
      <span className="spec-row-count">{spec.ok ? `${built}/${total}` : "!"}</span>
    </button>
  );
}
