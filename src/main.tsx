import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import "./types.ts";

// Dark until the app says otherwise: no light flash before the choice arrives.
document.documentElement.dataset.theme = "dark";
void window.turri.theme().then((theme) => (document.documentElement.dataset.theme = theme));
window.turri.on("theme", (theme: string) => (document.documentElement.dataset.theme = theme));

createRoot(document.getElementById("root")!).render(<App />);
