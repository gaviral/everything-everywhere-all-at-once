import { characters, sourceSpan, assertCoverage } from "../../msg1351/dictation-breakdown/source-span";
import { extractItem } from "../../msg1351/dictation-breakdown/item-extraction";
import { candidates } from "./candidate-part";
import { exactPart } from "./exact-part";
import { regexPart } from "./regex-part";
import { fuzzyPart } from "./fuzzy-part";
import { aiPart } from "./ai-part";
import type { Breakdown, Judgement, Switches, Trigger } from "./types";

export function breakdown(source: string, switches: Switches, judgements: Judgement[], example: boolean, joined: string[]): Breakdown {
  const triggers: Trigger[] = candidates(source).filter(row => row.source.start > 0).flatMap(row => {
    const evidence = (switches.exact && exactPart(row.source.text)) || (switches.regex && regexPart(row.source.text)) || (switches.fuzzy && fuzzyPart(row.source.text)) || (switches.ai && aiPart(row, judgements, example));
    return evidence ? [{ ...row, ...evidence }] : [];
  });
  const active = triggers.filter(row => !joined.includes(row.id));
  const cuts = [0, ...active.map(row => row.source.start), characters(source).length];
  const parts = source.length ? cuts.slice(0, -1).map((start, index) => ({ item: extractItem(sourceSpan(source, start, cuts[index + 1])), trigger: index ? active[index - 1] : undefined })) : [];
  const review = { source, items: parts.map(part => part.item) };
  assertCoverage(source, review.items);
  return { review, parts, triggers };
}
