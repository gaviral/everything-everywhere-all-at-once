// A part runs in a sealed frame: no network, no reach into the app. This wraps it, and tries it before it may merge.
const TRY_MS = 900;
const GIVE_UP_MS = 4000;
export const SEALED = "allow-scripts";

const LOCKED = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:`;

/** The part as a page. It reports a thrown error, and whether it drew anything, to whoever is watching. */
export const framed = (html: string) => `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${LOCKED}">
<style>html,body{margin:0;min-height:100%;background:transparent;font-family:system-ui,sans-serif}</style>
<script>
// A sealed frame has no storage of its own, and touching it throws: a part keeps its state in memory instead.
for(const name of ["localStorage","sessionStorage"]){const kept=new Map();Object.defineProperty(window,name,{value:{getItem:k=>kept.has(String(k))?kept.get(String(k)):null,setItem:(k,v)=>kept.set(String(k),String(v)),removeItem:k=>kept.delete(String(k)),clear:()=>kept.clear(),key:i=>[...kept.keys()][i]??null,get length(){return kept.size}}})}
addEventListener("error",e=>parent.postMessage({crew:"broke",why:String(e.message||e)},"*"));
addEventListener("unhandledrejection",e=>parent.postMessage({crew:"broke",why:String(e.reason)},"*"));
addEventListener("load",()=>setTimeout(()=>parent.postMessage({crew:"ran",drew:document.body.innerText.trim().length>0||document.body.querySelector("svg,canvas")!==null},"*"),${TRY_MS}));
</script>${html}`;

/** Runs the part unseen. Passing means no error and something drawn. */
export function tryPart(html: string): Promise<{ ok: boolean; why?: string }> {
  return new Promise(resolve => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", SEALED);
    frame.style.cssText = "position:fixed;left:-9999px;width:400px;height:280px;border:0";
    const done = (result: { ok: boolean; why?: string }) => {
      removeEventListener("message", heard);
      clearTimeout(timer);
      frame.remove();
      resolve(result);
    };
    const heard = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.crew === "broke") done({ ok: false, why: event.data.why });
      if (event.data?.crew === "ran") done(event.data.drew ? { ok: true } : { ok: false, why: "It drew nothing." });
    };
    const timer = setTimeout(() => done({ ok: false, why: "It never finished starting." }), GIVE_UP_MS);
    addEventListener("message", heard);
    frame.srcdoc = framed(html);
    document.body.append(frame);
  });
}
