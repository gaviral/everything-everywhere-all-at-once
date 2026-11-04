import { usePluginState } from "./bricks/contract";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ImportStatus } from "./core";
import { comesFirst, type Card as SendCard } from "./send-card";
import "./import.css";

// What the core found in a file, before anything is sent anywhere (POST /import).
interface Preview {
  id: string;
  file: string;
  format: string;
  conversations: number;
  total: number;
  already: number;
  messages: number;
  words: number;
  from_ms: number;
  to_ms: number;
  parts: number;
  extract_model: string;
  merge_model: string;
  cost: number;
}

type ImportCore = {
  importStatus: ImportStatus | null;
  sendCard: SendCard | null;
  startImport: (id: string) => boolean;
  cancelImport: () => boolean;
};

// Matches MAX_BYTES in core/src/import.rs.
const MAX_MB = 100;
// Imports run on the laptop that runs the core (its key, its person's chats); another laptop in a room
// gets no button, and the core refuses it anyway.
export const ON_THIS_MACHINE = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const RUNNING = new Set(["reading", "grouping", "adding"]);

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
// "muse-spark-1.3" reads as "Muse Spark 1.3".
const modelName = (id: string) => id.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

// "Added 34 points to 6 new threads, with 3 open questions and 8 tasks", leaving out what's zero.
function summary(job: ImportStatus) {
  const places = [job.threads && plural(job.threads, "new topic"), job.extended && `${plural(job.extended, "topic")} you already had`].filter(Boolean);
  const extras = [job.questions && plural(job.questions, "open question"), job.actions && plural(job.actions, "task")].filter(Boolean);
  return `Added ${plural(job.points, "point")}${places.length ? ` to ${places.join(" and ")}` : ""}${extras.length ? `, with ${extras.join(" and ")}` : ""}.`;
}

// Reading is most of the wait; grouping and adding are the last stretch.
function progress(status: ImportStatus) {
  if (status.state === "reading") return 0.05 + (status.parts ? 0.75 * (status.parts_done / status.parts) : 0);
  if (status.state === "grouping") return 0.85;
  if (status.state === "adding") return 0.95;
  return 1;
}

/** "Import chats" in the header, and the panel it opens: choose a file (or the sample), see what will be sent where, then follow the import. */
export function ImportChats({ core }: { core: ImportCore }) {
  const [open, setOpen] = usePluginState("import:open", false);
  const [step, setStep] = usePluginState<"choose" | "reading" | "preview" | "error">("import:step", "choose");
  const [fileName, setFileName] = usePluginState("import:fileName", "");
  const [preview, setPreview] = usePluginState<Preview | null>("import:preview", null);
  const [error, setError] = usePluginState("import:error", "");
  const [started, setStarted] = usePluginState("import:started", "");
  const [dragging, setDragging] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const status = core.importStatus;
  const running = !!status && RUNNING.has(status.state);
  // The import this window started, or any import still running (another window may have started it).
  const job = status && (running || status.id === started) ? status : null;

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) {
      previousFocus.current = document.activeElement as HTMLElement | null;
      element.showModal();
    }
    if (!open && element?.open) {
      element.close();
      previousFocus.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // A message that starts counting comes first: this modal sheet would cover its countdown and make its Stop inert.
  useEffect(() => {
    if (open && comesFirst(core.sendCard)) setOpen(false);
  }, [open, core.sendCard?.id, core.sendCard?.state]);

  const reset = () => {
    setStep("choose");
    setPreview(null);
    setError("");
    setStarted("");
  };

  const upload = async (blob: Blob, name: string) => {
    setFileName(name);
    setPreview(null);
    if (blob.size > MAX_MB * 1024 * 1024) {
      setError(`${name} is ${Math.round(blob.size / 1024 / 1024)} MB; the limit is ${MAX_MB} MB.`);
      setStep("error");
      return;
    }
    setStep("reading");
    try {
      const response = await fetch(`/import?name=${encodeURIComponent(name)}`, { method: "POST", body: blob });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? (response.status === 413 ? `${name} is over the ${MAX_MB} MB limit.` : "Couldn't read that file."));
      setPreview(body as Preview);
      setStep("preview");
    } catch (err) {
      setError(err instanceof TypeError ? "Couldn't upload the file. Check that E2A2O is running, then try again." : err instanceof Error ? err.message : "Couldn't read that file.");
      setStep("error");
    }
  };

  const choose = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) void upload(file, file.name);
  };

  const trySample = async () => {
    const response = await fetch("/sample-chats.json").catch(() => null);
    if (response?.ok) return upload(await response.blob(), "sample-chats.json");
    setError("Couldn't load the sample.");
    setStep("error");
  };

  const start = () => {
    if (!preview) return;
    if (core.startImport(preview.id)) setStarted(preview.id);
    else {
      setError("Not connected. Try again once E2A2O reconnects.");
      setStep("error");
    }
  };

  // A file dropped anywhere opens the import, instead of the browser leaving the map to show the file.
  useEffect(() => {
    if (!ON_THIS_MACHINE) return;
    const hasFile = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");
    const over = (event: DragEvent) => {
      if (!hasFile(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFile(event)) return;
      event.preventDefault();
      setDragging(false);
      setOpen(true);
      if (!running) choose(event.dataTransfer?.files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [running]);

  const close = () => {
    setOpen(false);
    if (job && !running) reset();
  };

  const contributor = preview && [preview.extract_model, preview.merge_model].find((model) => model.includes("contributor"));

  const body = job ? (
    running ? (
      <>
        <div className="import-eyebrow">Making your map</div>
        <h2 id="import-title">Importing {job.file}</h2>
        <div className="import-bar" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress(job) * 100)}>
          <span style={{ width: `${progress(job) * 100}%` }} />
        </div>
        <div role="status">
          <p className="import-line">
            {job.state === "reading" && `Reading your chats: ${job.parts_done} of ${plural(job.parts, "part")} read`}
            {job.state === "grouping" && `Sorting ${plural(job.ideas, "idea")} into topics…`}
            {job.state === "adding" && `Adding to your map: ${plural(job.threads, "topic")} so far`}
          </p>
          {job.state === "reading" && job.ideas > 0 && (
            <p className="import-note">
              {plural(job.ideas, "idea")} so far · about {plural(job.threads, "topic")}
            </p>
          )}
        </div>
        <p className="import-note">You can close this; the import keeps going.</p>
        <div className="import-actions">
          <button onClick={() => core.cancelImport()}>Stop</button>
        </div>
      </>
    ) : (
      <>
        <h2 id="import-title">{job.state === "done" ? "Imported" : job.state === "stopped" ? "Import stopped" : "Import didn't finish"}</h2>
        <div role="status">
          {job.state === "done" && <p className="import-line">{summary(job)}</p>}
          {job.note && <p className="import-note">{job.note}</p>}
        </div>
        <div className="import-actions">
          <button className="primary" onClick={close}>{job.state === "done" ? "See the map" : "Close"}</button>
          <button onClick={reset}>{job.state === "failed" ? "Try again" : "Import another"}</button>
        </div>
      </>
    )
  ) : step === "reading" ? (
    <>
      <h2 id="import-title">Import your chats</h2>
      <p className="import-line" role="status">Reading {fileName}…</p>
    </>
  ) : step === "preview" && preview ? (
    <>
      <h2 id="import-title">Import your chats</h2>
      <div>
        <div className="import-file">{preview.file}</div>
        <div className="import-facts">
          {preview.format} · {plural(preview.conversations, "conversation")} · {plural(preview.messages, "message")} of yours ·{" "}
          {day(preview.from_ms) === day(preview.to_ms) ? day(preview.from_ms) : `${day(preview.from_ms)} – ${day(preview.to_ms)}`}
        </div>
      </div>
      {preview.already > 0 && (
        <p className="import-note">{plural(preview.already, "message")} of yours from this file {preview.already === 1 ? "was" : "were"} imported before, so {preview.already === 1 ? "it's" : "they're"} skipped.</p>
      )}
      {preview.total - preview.already > preview.messages && (
        <p className="import-note">
          To keep this quick, the import reads your latest {preview.messages.toLocaleString()} of {(preview.total - preview.already).toLocaleString()} messages, from {day(preview.from_ms)} on.
        </p>
      )}
      <div className="import-privacy">
      <h3>Before you import</h3>
      <ul className="import-list">
        <li>
          Your {plural(preview.messages, "message")} (about {plural(preview.words, "word")}), with the first lines of each AI reply for context, go to
          Meta's {modelName(preview.extract_model)} to pick out your ideas.
        </li>
        <li>The ideas it finds, not your messages, go to {modelName(preview.merge_model)} to sort them into topics, open questions and tasks.</li>
        <li>
          Costs about {preview.cost < 0.01 ? "a cent" : `$${preview.cost.toFixed(2)}`}, plus about $0.01 for each topic picture drawn afterwards.
        </li>
        <li>The file itself isn't kept. The points are saved with your map, on this computer.</li>
      </ul>
      </div>
      {contributor && (
        <p className="import-warn">{modelName(contributor)} is in Contributor mode: Meta may keep what's sent to improve its products.</p>
      )}
      <div className="import-actions">
        <button className="primary" onClick={start}>Import {plural(preview.messages, "message")}</button>
        <button onClick={reset}>Choose another file</button>
      </div>
    </>
  ) : (
    <>
      <h2 id="import-title">Import your chats</h2>
      <p className="import-lead">Turn your ChatGPT or Claude conversations into topics, questions and tasks on this map. Only your own messages become points.</p>
      {step === "error" && (
        <p className="import-warn" role="alert">
          {error}
        </p>
      )}
      <div className={dragging ? "import-drop over" : "import-drop"}>
        <span>Drop conversations.json here</span>
        <div className="import-actions">
          <button className="primary" onClick={() => picker.current?.click()}>Choose a file</button>
          <button onClick={() => void trySample()}>Try with a sample</button>
        </div>
      </div>
      <input
        ref={picker}
        type="file"
        accept=".json,.jsonl,application/json"
        hidden
        onChange={(event) => {
          choose(event.target.files);
          event.target.value = "";
        }}
      />
      <p className="import-help">
        From ChatGPT: Settings › Data controls › Export data. From Claude: Settings › Privacy › Export data. Unzip the download and choose
        conversations.json. A JSON list of messages works too, up to {MAX_MB} MB.
      </p>
    </>
  );

  if (!ON_THIS_MACHINE) return null;
  const percent = running && status ? `${Math.round(progress(status) * 100)}%` : "";
  const label = percent ? `Importing ${percent}` : "Import chats";
  return (
    <>
      {/* On a phone the header has no room for words: an icon, or the percentage while importing. */}
      <button className="import-open" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={label} data-guide="import">
        <span className="import-long">{label}</span>
        <span className="import-short">{percent || <ImportIcon />}</span>
      </button>
      {createPortal(
        <>
          <dialog
            ref={dialog}
            className="import-dialog"
            aria-labelledby="import-title"
            onCancel={(event) => { event.preventDefault(); close(); }}
            onClose={close}
            onClick={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <div className="import-body">
              <button className="import-close" onClick={close} aria-label="Close">
                ×
              </button>
              {body}
            </div>
          </dialog>
          {dragging && !open && <div className="import-drag">Drop to import your chats</div>}
        </>,
        document.body,
      )}
    </>
  );
}

function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3" />
    </svg>
  );
}
