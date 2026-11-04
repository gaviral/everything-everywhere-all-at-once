import { forwardRef } from "react";

const WORD_PARTS = [
  { word: "Everything", mark: "E" },
  { word: "Everywhere", mark: "2" },
  { word: "All", mark: "A" },
  { word: "at", mark: "2" },
  { word: "Once", mark: "O" },
];

/** Each word part has a leading letter, a disappearing tail and, when needed, a number. */
function WordPart({ word, mark }: { word: string; mark: string }) {
  const changesPart = word[0] !== mark;
  return <span className="intro-parts-word">
    <span className="intro-parts-lead"><span className={changesPart ? "intro-parts-original" : undefined}>{word[0]}</span>
      {changesPart && <span className="intro-parts-number">{mark}</span>}
    </span><span className="intro-parts-tail">{word.slice(1)}</span>
  </span>;
}

function NameLinesPart() {
  return <div className="intro-parts-name">
    <div className="intro-parts-line"><WordPart {...WORD_PARTS[0]} /></div>
    <div className="intro-parts-line"><WordPart {...WORD_PARTS[1]} /></div>
    <div className="intro-parts-line">{WORD_PARTS.slice(2).map(part => <WordPart key={part.word} {...part} />)}</div>
  </div>;
}

function CompactMeasurePart() {
  return <div className="intro-parts-measure">{"E2A2O".split("").map((part, index) => <span key={index}>{part}</span>)}</div>;
}

/** This visual part is decorative: the app's existing identity remains the accessible name. */
export const NamePart = forwardRef<HTMLDivElement>(function NamePart(_, ref) {
  return <div ref={ref} className="intro-parts" aria-hidden="true" data-guide="intro-parts">
    <div className="intro-parts-paper" />
    <NameLinesPart />
    <CompactMeasurePart />
    <p className="intro-parts-hint">Any key or tap to skip</p>
  </div>;
});
