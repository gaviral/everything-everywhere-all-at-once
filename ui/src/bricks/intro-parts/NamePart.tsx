import { forwardRef } from "react";
import { AppMark } from "../../AppMark";

const WORD_PARTS = ["Everything", "Everywhere", "All", "at", "Once"];

function WordPart({ word }: { word: string }) {
  return <span className="intro-parts-word"><span className="intro-parts-lead">{word}</span></span>;
}

function NameLinesPart() {
  return <div className="intro-parts-name">
    <div className="intro-parts-line"><WordPart word={WORD_PARTS[0]} /></div>
    <div className="intro-parts-line"><WordPart word={WORD_PARTS[1]} /></div>
    <div className="intro-parts-line">{WORD_PARTS.slice(2).map(part => <WordPart key={part} word={part} />)}</div>
  </div>;
}

/** This visual part is decorative: the app's existing identity remains the accessible name. */
export const NamePart = forwardRef<HTMLDivElement>(function NamePart(_, ref) {
  return <div ref={ref} className="intro-parts" aria-hidden="true" data-guide="intro-parts">
    <div className="intro-parts-paper" />
    <NameLinesPart />
    <div className="intro-parts-icon"><AppMark size="100%" /></div>
    <p className="intro-parts-hint">Any key or tap to skip</p>
  </div>;
});
