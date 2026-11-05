import { useEffect, useState } from "react";
import "./light-theme.css";
import "./glass.css";

const looks = [
  { id: "paper", name: "Warm paper" },
  { id: "studio", name: "Cool studio" },
  { id: "contrast", name: "High contrast" },
  { id: "glass", name: "Glass" },
] as const;
type Look = typeof looks[number]["id"];
const key = "e2a2o.light-theme.look";

function savedLook(): Look {
  try {
    const saved = localStorage.getItem(key);
    return looks.find(look => look.id === saved)?.id ?? "paper";
  } catch { return "paper"; }
}

function LookSwitch({ look, choose }: { look: Look; choose: (look: Look) => void }) {
  return <div className="light-theme-switch" role="group" aria-label="Light theme look">
    <span>Look</span>
    {looks.map(item => <button key={item.id} type="button" aria-pressed={look === item.id}
      onClick={() => choose(item.id)}>{item.name}</button>)}
  </div>;
}

export default function LightTheme() {
  const [look, setLook] = useState<Look>(savedLook);
  useEffect(() => {
    document.documentElement.dataset.lightTheme = look;
    try { localStorage.setItem(key, look); } catch { /* The look still works for this visit. */ }
    return () => { delete document.documentElement.dataset.lightTheme; };
  }, [look]);
  return <LookSwitch look={look} choose={setLook} />;
}
