import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PreviewState } from "../electron/preview.ts";
import { Empty, Icon } from "./ui.tsx";

const BLANK: PreviewState = { url: "", title: "", loading: false, canGoBack: false, canGoForward: false, error: null };

/** The address last open for each project, so its preview opens there again. */
const keyFor = (dir: string) => `turri-app.preview:${dir}`;
function savedUrl(dir: string): string {
  try {
    return localStorage.getItem(keyFor(dir)) ?? "";
  } catch {
    return "";
  }
}

/** What is typed in the address bar, as an address: `8000` and `localhost:8000` are http://localhost:8000. */
function addressOf(typed: string): string {
  const text = typed.trim();
  if (/^\d+(\/.*)?$/.test(text)) return `http://localhost:${text}`;
  return /^\w+:\/\//.test(text) ? text : `http://${text}`;
}

/**
 * The app turri builds, in a browser pane: an address bar, and below it the pane itself - a page of its own the main
 * process lays over the space left here for it (electron/preview.ts). Nothing of the window can draw over it, so it is
 * taken away while something should: a sheet open over the window, or nothing loaded to show. turri drives the same
 * pane with its browser tools, and the window comes here when it does.
 */
export function PreviewView({ dir, covered }: { dir: string; covered: boolean }) {
  const [state, setState] = useState<PreviewState>(BLANK);
  const [typed, setTyped] = useState("");
  // The address this project had last: offered, not opened - another project's app may answer there now.
  const [last, setLast] = useState("");
  const page = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const off = window.turri.on("preview:state", (next: PreviewState) => setState(next));
    void window.turri.preview.state().then((now) => {
      setState(now);
      // Nothing open yet: the address this project had last, in the bar to open - or the bar, to type one.
      const saved = savedUrl(dir);
      setLast(saved);
      if (!now.url) setTyped(saved);
      if (!now.url) address.current?.focus();
    });
    return off;
  }, [dir]);

  useEffect(() => {
    if (!state.url || state.error) return;
    try {
      localStorage.setItem(keyFor(dir), state.url);
    } catch {
      /* not kept: the preview opens empty next time */
    }
  }, [dir, state.url, state.error]);

  // The address bar says where the page is: wherever it goes - a link, turri - what was typed gives way to it.
  useEffect(() => {
    if (state.url) setTyped(state.url);
  }, [state.url]);

  // The pane over the space below the bar: placed while there is a page to show and nothing over it, and moved with it.
  const showing = state.url !== "" && state.error === null && !covered;
  useLayoutEffect(() => {
    const box = page.current;
    if (!showing || box === null) {
      void window.turri.preview.place(null);
      return;
    }
    const place = () => {
      const { x, y, width, height } = box.getBoundingClientRect();
      void window.turri.preview.place({ x, y, width, height });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [showing]);
  // Gone from the window - another view, another file - the pane goes too.
  useEffect(() => () => void window.turri.preview.place(null), []);

  const open = (typed: string) => {
    if (!typed.trim()) return;
    address.current?.blur();
    void window.turri.preview.open(addressOf(typed));
  };

  return (
    <div className="preview">
      <div className="preview-bar">
        <button className="icon-button" disabled={!state.canGoBack} onClick={() => void window.turri.preview.go("back")} title="back">
          <Icon name="back" />
        </button>
        <button className="icon-button" disabled={!state.canGoForward} onClick={() => void window.turri.preview.go("forward")} title="forward">
          <Icon name="forward" />
        </button>
        <button className="icon-button" disabled={!state.url} onClick={() => void window.turri.preview.go(state.loading ? "stop" : "reload")} title={state.loading ? "stop" : "reload"}>
          <Icon name={state.loading ? "x" : "reload"} />
        </button>
        <form
          className="preview-address"
          onSubmit={(event) => {
            event.preventDefault();
            open(typed);
          }}
        >
          <input
            ref={address}
            value={typed}
            placeholder="localhost:8000"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTyped(state.url);
                event.currentTarget.blur();
              }
            }}
          />
        </form>
        <button className="icon-button" disabled={!state.url} onClick={() => void window.turri.preview.go("devtools")} title="developer tools for the page">
          <Icon name="code" />
        </button>
        {state.loading && <span className="preview-loading" />}
      </div>
      <div className="preview-page" ref={page}>
        {!state.url ? (
          <Empty icon="globe" title="open the app you are building">
            type its address above - <kbd>localhost:8000</kbd>, say. turri can open it here too, and see and try it as you watch.
            {last && (
              <span className="preview-retry">
                <button className="button" onClick={() => open(last)}>
                  <Icon name="globe" /> open {last.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </button>
              </span>
            )}
          </Empty>
        ) : state.error !== null ? (
          <Empty icon="warn" title="nothing answers there">
            {state.error}. Start the app - or ask turri to release it - then reload.
            <span className="preview-retry">
              <button className="button" onClick={() => void window.turri.preview.go("reload")}>
                <Icon name="reload" /> reload
              </button>
            </span>
          </Empty>
        ) : null}
      </div>
    </div>
  );
}
