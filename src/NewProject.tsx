import { useEffect, useRef, useState } from "react";
import type { Project } from "./types.ts";
import { Spinner } from "./ui.tsx";

type Maker = "anthropic" | "openai";
interface Vendors {
  vendors: Array<{ id: string; label: string; harness: string; coding: string }>;
  regions: Record<Maker, string[]>;
  bedrockDefault: { maker: Maker; region: string };
  /** Bedrock's two models for each maker and geography: `${maker}/${region}`. */
  bedrockModels: Record<string, { harness: string; coding: string }>;
}

/**
 * A new project: its folder named in the save sheet, then the models it runs on chosen here - turri's vendors, as
 * `turri init-config` offers them - and its config.turri.yaml written before it opens, so the chat starts on them.
 */
export function NewProject({ onOpened, onDone }: { onOpened: (project: Project) => void; onDone: () => void }) {
  const [dir, setDir] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendors | null>(null);
  const [vendor, setVendor] = useState<string | null>(null);
  const [maker, setMaker] = useState<Maker>("anthropic");
  const [region, setRegion] = useState("global");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.turri.newProject().then(
      (chosen: string | null) => (chosen === null ? onDone() : setDir(chosen)),
      (failure: Error) => setError(plain(failure)),
    );
    void window.turri.vendors().then((all: Vendors) => {
      setVendors(all);
      setMaker(all.bedrockDefault.maker);
      setRegion(all.bedrockDefault.region);
    }, (failure: Error) => setError(plain(failure)));
  }, []);

  // Given up before it started: the folder made for it goes again, while it is still empty.
  const cancel = () => {
    if (dir !== null) void window.turri.abandonProject(dir);
    onDone();
  };

  // Started once: its config is written once, with the models chosen when Create was pressed.
  const started = useRef(false);
  const start = async () => {
    if (dir === null || vendor === null || started.current) return;
    started.current = true;
    setStarting(true);
    try {
      const project = await window.turri.startProject(dir, vendor, vendor === "amazon-bedrock" ? { maker, region } : undefined);
      onDone();
      onOpened(project);
    } catch (failure) {
      started.current = false;
      setError(plain(failure as Error));
      setStarting(false);
    }
  };

  // The save sheet is the system's: nothing of the window's until a folder is chosen, unless that went wrong.
  if (dir === null && error === null) return null;
  const name = dir?.split("/").at(-1) ?? "";
  const models = (id: string) => {
    if (id === "amazon-bedrock" && vendors) return vendors.bedrockModels[`${maker}/${region}`];
    return vendors?.vendors.find((entry) => entry.id === id);
  };

  return (
    <div className="sheet-backdrop">
      <div className="sheet new-project">
        {dir === null ? (
          <>
            <h2>The project was not made</h2>
            <p className="error-text">{error}</p>
            <div className="sheet-actions">
              <button className="button primary" onClick={onDone} autoFocus>
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Which models does {name} use?</h2>
            <p className="muted">turri writes them into its config.turri.yaml: a strong one you talk to, and a smaller one that writes the code. The file can change them later.</p>
            {vendors === null ? (
              <Spinner />
            ) : (
              <div className="options">
                {vendors.vendors.map((entry) => {
                  const shown = models(entry.id);
                  return (
                    <button key={entry.id} className={`option ${vendor === entry.id ? "on" : ""}`} onClick={() => setVendor(entry.id)} aria-pressed={vendor === entry.id}>
                      <strong>{entry.label}</strong>
                      {shown && (
                        <span className="option-detail">
                          you talk to {shown.harness} · it codes {shown.coding}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {vendor === "amazon-bedrock" && vendors && (
              <div className="bedrock">
                <div className="bedrock-row">
                  <span className="muted">Whose models</span>
                  <div className="segmented">
                    {(["anthropic", "openai"] as Maker[]).map((each) => (
                      <button
                        key={each}
                        className={maker === each ? "on" : ""}
                        onClick={() => {
                          setMaker(each);
                          if (!vendors.regions[each].includes(region)) setRegion(vendors.regions[each][0]!);
                        }}
                      >
                        {each === "anthropic" ? "Anthropic" : "OpenAI"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bedrock-row">
                  <span className="muted">Where</span>
                  <div className="segmented">
                    {vendors.regions[maker].map((each) => (
                      <button key={each} className={region === each ? "on" : ""} onClick={() => setRegion(each)}>
                        {each}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <div className="sheet-actions">
              <button className="button" onClick={cancel} disabled={starting}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void start()} disabled={vendor === null || starting}>
                {starting ? (
                  <>
                    <Spinner /> Starting turri…
                  </>
                ) : (
                  "Create"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** An error as the main process said it, without Electron's wrapping. */
function plain(failure: Error) {
  return String(failure.message ?? failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
