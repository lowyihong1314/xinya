import ReactDOM from "react-dom/client";

import { ScorePanelPage } from "./src/form/react/score_panel/ScorePanelPage";

const mount = document.getElementById("root") ?? document.getElementById("app");
if (!mount) {
  throw new Error("Score panel mount node not found. Expected #root or #app.");
}
ReactDOM.createRoot(mount as HTMLElement).render(<ScorePanelPage />);
