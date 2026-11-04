import { usePluginState, type BrickProps } from "../contract";
import Deadline from "./Deadline";
import Submission from "./Submission";
import Rules from "./Rules";
import Drafts from "./Drafts";
import { content } from "./model";
import style from "./hackathon.css?inline";

const sections = [{ id: "submission", label: "Submission" }, { id: "rules", label: "Rules & tracks" }, { id: "drafts", label: "Answer drafts" }] as const;
type Section = typeof sections[number]["id"];

function Rubric() {
  return <section className="hackathon-rubric" aria-label="Judging rubric, 100 points">
    {content.rubric.map(item => <div key={item.name}>
      <strong>{item.points}<small>/100</small></strong><div><h3>{item.name}</h3><p>{item.prompt}</p></div>
    </div>)}
  </section>;
}

export default function Hackathon(_props: BrickProps) {
  const [section, setSection] = usePluginState<Section>("hackathon:section", "submission");
  return <div className="hackathon" data-guide="hackathon">
    <div className="hackathon-hero">
      <div className="hackathon-intro"><p className="hackathon-eyebrow">{content.event} <span>· Hackathon</span></p>
        <h1>{content.title}</h1><p className="hackathon-subtitle">{content.subtitle}</p>
      </div><Deadline />
    </div>
    <Rubric />
    <nav className="hackathon-navigation" aria-label="Hackathon sections">{sections.map(item => <button type="button" key={item.id}
      aria-current={section === item.id ? "page" : undefined} aria-controls="hackathon-content" onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>
    <div id="hackathon-content" className="hackathon-content">
      {section === "submission" ? <Submission /> : section === "rules" ? <Rules /> : <Drafts />}
    </div>
    <p className="hackathon-source">{content.sourceNote}</p>
  </div>;
}

export const styles = style;
