import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatItem, ChatStats, Question, SkillProgress } from "./Chat.tsx";

/** A chat of turri's session, as the engine lists it: in the order they were opened. */
export type ChatInfo = {
  id: string;
  /** "new chat" until something is said in it, then its first message. */
  title: string;
  /** A turn running, or something said since it was last shown. */
  status: "idle" | "working" | "question" | "unread";
  shown: boolean;
};

/** What the window keeps of each chat: what it said, what it is doing, and what it asks. */
export type ChatState = {
  items: ChatItem[];
  /** What the person said while turri answered, waiting for its turn to end. */
  queued: string[];
  /** What waited, its turn stopped: back in the message box - `at` tells one from the next. */
  restored: { text: string; at: number } | null;
  streaming: ChatItem | null;
  busy: boolean;
  working: string | null;
  tools: Map<string, boolean>;
  statuses: Record<string, string>;
  questions: Question[];
  progress: SkillProgress | null;
  model: string | null;
  stats: ChatStats | null;
};

const EMPTY: ChatState = { items: [], queued: [], restored: null, streaming: null, busy: false, working: null, tools: new Map(), statuses: {}, questions: [], progress: null, model: null, stats: null };

type History = { messages: ChatItem[]; queued?: string[]; model: string | null; stats: ChatStats; questions: Question[] };

/**
 * turri's chats in the window: each one's state, kept whether it is shown or not - a hidden chat goes on working, and
 * what it said and asks is there when it is shown - from the engine's events, each of the chat it is of.
 */
export function useChats({ onAsk, onError }: { onAsk: () => void; onError: (text: string) => void }) {
  const [list, setList] = useState<ChatInfo[]>([]);
  const [states, setStates] = useState<Map<string, ChatState>>(new Map());
  const update = useCallback((id: string, change: (state: ChatState) => Partial<ChatState>) => {
    setStates((all) => {
      const now = all.get(id) ?? EMPTY;
      return new Map(all).set(id, { ...now, ...change(now) });
    });
  }, []);
  /** Notes to put after a chat's history once it is read: a new project's config, said in its first chat. */
  const after = useRef(new Map<string, ChatItem[]>());
  /** The chats read from the engine already: one the engine tells of anew is read once. */
  const known = useRef(new Set<string>());

  /** A chat read from the engine: what was said in it, its model, how full it is, and what it asks now. */
  const load = useCallback(
    (id: string) =>
      void window.turri.call<History>("chatHistory", { chat: id }).then(
        ({ messages, queued = [], model, stats, questions }) => {
          const notes = after.current.get(id) ?? [];
          after.current.delete(id);
          update(id, () => ({ items: [...messages, ...notes], queued, model, stats, questions }));
        },
        () => {},
      ),
    [update],
  );

  /** The chats of a project just opened - or of the window drawn again - read anew; `notes` after the first one's history. */
  const reset = useCallback(
    async (notes: ChatItem[] = []) => {
      setStates(new Map());
      after.current.clear();
      const chats = await window.turri.call<ChatInfo[]>("chats").catch(() => [] as ChatInfo[]);
      setList(chats);
      known.current = new Set(chats.map((chat) => chat.id));
      if (chats[0] !== undefined && notes.length > 0) after.current.set(chats[0].id, notes);
      for (const chat of chats) load(chat.id);
    },
    [load],
  );

  useEffect(() => {
    const on = <T,>(event: string, handle: (id: string, data: T) => void) => window.turri.on(`engine:${event}`, ({ chat, data }: { chat: string; data: T }) => handle(chat, data));
    const off = [
      window.turri.on("engine:chats", (chats: ChatInfo[]) => {
        setList(chats);
        // One opened is read; one closed is let go.
        for (const chat of chats) if (!known.current.has(chat.id)) (known.current.add(chat.id), load(chat.id));
        const open = new Set(chats.map((chat) => chat.id));
        known.current = open;
        setStates((all) => new Map([...all].filter(([id]) => open.has(id))));
      }),
      on<ChatItem>("chat:message", (id, item) => update(id, (state) => ({ items: [...state.items, item] }))),
      on<{ texts: string[] }>("chat:queued", (id, { texts }) => update(id, () => ({ queued: texts }))),
      on<{ text: string }>("chat:restore", (id, { text }) => update(id, () => ({ restored: { text, at: Date.now() } }))),
      on<ChatItem | null>("chat:streaming", (id, item) => update(id, () => ({ streaming: item }))),
      on<{ busy: boolean }>("chat:busy", (id, { busy }) => update(id, (state) => ({ busy, working: busy ? state.working : null }))),
      on<{ text: string | null }>("chat:working", (id, { text }) => update(id, () => ({ working: text }))),
      on<{ id: string; running: boolean }>("chat:tool", (id, tool) => update(id, (state) => ({ tools: new Map(state.tools).set(tool.id, tool.running) }))),
      on<{ key: string; text: string | null }>("chat:status", (id, { key, text }) => update(id, (state) => ({ statuses: { ...state.statuses, [key]: text ?? "" } }))),
      on<{ level: string; text: string }>("chat:notify", (id, { level, text }) => {
        update(id, (state) => ({ items: [...state.items, { role: "note", text, level }] }));
        if (level === "error") onError(text.split("\n")[0]!);
      }),
      on<SkillProgress | null>("chat:progress", (id, progress) => update(id, () => ({ progress }))),
      on<{ model: string }>("chat:model", (id, { model }) => update(id, () => ({ model }))),
      on<ChatStats>("chat:stats", (id, stats) => update(id, () => ({ stats }))),
      on<Question>("chat:ask", (id, question) => {
        update(id, (state) => ({ questions: [...state.questions, question] }));
        onAsk();
      }),
      // A question over unanswered - declined, its turn stopped: its card put away.
      on<{ id: number }>("chat:unask", (id, { id: asked }) => update(id, (state) => ({ questions: state.questions.filter((question) => question.id !== asked) }))),
    ];
    return () => off.forEach((stop) => stop());
  }, [update, load, onAsk, onError]);

  const shownId = (list.find((chat) => chat.shown) ?? list[0])?.id ?? null;
  return {
    list,
    shownId,
    /** The chat shown's state - empty until it is read. */
    shown: (shownId !== null ? states.get(shownId) : undefined) ?? EMPTY,
    /** The chats with a question waiting: marked so in the tabs. */
    asking: new Set([...states].filter(([, state]) => state.questions.length > 0).map(([id]) => id)),
    reset,
    /** The chat's first question answered: put away. */
    answered: (id: string) => update(id, (state) => ({ questions: state.questions.slice(1) })),
  };
}
