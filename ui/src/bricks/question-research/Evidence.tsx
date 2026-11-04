import type { ResearchKept } from "../contract";
import { answerParts, safeCitation } from "./rules";

/** Links sit on the exact passage supported by the provider's citation. */
export function Evidence({ answer }: { answer: Readonly<ResearchKept> }) {
  const citations = answer.citations.filter(c => safeCitation(c, answer.answer));
  return <div className="question-research-evidence">
    {answer.simulated && <strong className="question-research-simulated">Simulated research</strong>}
    <p>{answerParts(answer.answer, citations).map(part => <span key={part.start} data-supported={part.supported}>
      {part.text}{part.citations.map((c, i) => <a key={i} href={c.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Source: ${c.title}`}> [{c.title}]</a>)}
    </span>)}</p>
    {!citations.length && <p>No cited answer returned</p>}
    <ul aria-label="Research sources">{citations.map((c, i) => <li key={i}>{c.title}</li>)}</ul>
    <small>{answer.model} · {new Date(answer.at_ms).toLocaleString()}</small>
  </div>;
}
