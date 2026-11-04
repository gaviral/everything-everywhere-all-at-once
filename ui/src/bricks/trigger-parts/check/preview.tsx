import { createRoot } from "react-dom/client";
import TriggerParts, { styles } from "../index";
const sheet = document.createElement("style");
sheet.textContent = styles;
document.head.append(sheet);
createRoot(document.getElementById("root")!).render(<TriggerParts />);
