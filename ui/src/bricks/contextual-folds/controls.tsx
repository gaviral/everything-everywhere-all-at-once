export type Display = { identity: boolean; time: boolean };

export function ReadingControls({ example, changeContent, display, changeDisplay, close }: {
  example: boolean; changeContent(example: boolean): void; display: Display;
  changeDisplay(display: Display): void; close(): void;
}) {
  return <div className="contextual-folds-controls" aria-label="Reading controls">
    <div className="contextual-folds-choices" role="group" aria-label="Reading source">
      <button type="button" aria-pressed={!example} onClick={() => changeContent(false)}>This map</button>
      <button type="button" aria-pressed={example} onClick={() => changeContent(true)}>Example</button>
    </div>
    <div className="contextual-folds-choices" role="group" aria-label="Show beside the words">
      <button type="button" aria-pressed={display.identity} onClick={() => changeDisplay({ ...display, identity: !display.identity })}>Names</button>
      <button type="button" aria-pressed={display.time} onClick={() => changeDisplay({ ...display, time: !display.time })}>Times</button>
    </div>
    <button type="button" className="contextual-folds-back" onClick={close}>Back to map ↗</button>
  </div>;
}
