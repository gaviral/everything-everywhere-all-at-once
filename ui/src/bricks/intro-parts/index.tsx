import type { BrickProps } from "../contract";
import { NamePart } from "./NamePart";
import { useIntroPart } from "./lifecycle-part";
import "./intro-parts.css";

/** The opening part orchestrates the session, interruption, name and motion parts. */
export default function IntroPart({ on }: BrickProps) {
  const { showPart, rootPart } = useIntroPart(on);
  return showPart ? <NamePart ref={rootPart} /> : null;
}
