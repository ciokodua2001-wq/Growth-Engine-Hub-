import { createRoot } from "react-dom/client";
import { installAuthFetch } from "./lib/authFetch";
import App from "./App";
import "./index.css";

// Must run before any component mounts and starts firing API requests.
installAuthFetch();

createRoot(document.getElementById("root")!).render(<App />);
