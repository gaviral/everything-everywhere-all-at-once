import { useEffect, useRef, useState } from "react";
import type { BrickProps, EvidenceKept, EvidencePoint, EvidenceRequest } from "../contract";
import { prepareImage } from "./rules";
import "./image-evidence.css";
export default function ImageEvidence({map,actions}:BrickProps){
  const [preview,setPreview]=useState("");const [target,setTarget]=useState("");const [title,setTitle]=useState("");
  const [proposal,setProposal]=useState<{id:string;points:EvidencePoint[]}|null>(null);const [selected,setSelected]=useState(new Set<number>());
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [retry,setRetry]=useState<EvidenceRequest|null>(null);
  const [shown,setShown]=useState<Readonly<EvidenceKept>|null>(null);const [region,setRegion]=useState<EvidencePoint["region"]>(null);
  const mounted=useRef(true), generation=useRef(0), locked=useRef(false);const chooser=useRef<HTMLInputElement>(null);
  const focusChooser=useRef(false);
  useEffect(()=>{if(!busy&&focusChooser.current){focusChooser.current=false;chooser.current?.focus();}});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const records=map.evidenceKept??[];
  async function send(req:EvidenceRequest){return actions.imageEvidence?.(req);}
  async function extract(){
    if(locked.current||!preview||!target)return;locked.current=true;setBusy(true);setMessage("Extracting proposed points…");setProposal(null);setRetry(null);
    const run=++generation.current;const id=crypto.randomUUID();const data=preview.split(",")[1];
    try {
      for(let i=0;i<data.length;i+=40000){const result=await send({type:"evidence_chunk",request_id:id,target,title,index:i/40000,data:data.slice(i,i+40000)});if(!result?.ok)throw new Error(result?.message??"Image evidence unavailable.");}
      const result=await send({type:"extract_evidence",request_id:id});
      if(!mounted.current||generation.current!==run)return;
      if(!result?.ok||!result.data?.points||!result.data.preview)throw new Error(result?.message??"Extraction unavailable.");
      setPreview(result.data.preview);setProposal({id,points:result.data.points});setSelected(new Set(result.data.points.map(p=>p.index)));setMessage("Review and edit each proposed point. Nothing kept yet.");
    }catch(error){if(mounted.current&&generation.current===run)setMessage(error instanceof Error?error.message:"Extraction unavailable. Draft kept.");}
    finally{if(mounted.current&&generation.current===run){setBusy(false);locked.current=false;}}
  }
  async function save(req:EvidenceRequest){
    if(locked.current)return;locked.current=true;setBusy(true);setRetry(req);setMessage("Waiting for map save…");const run=generation.current;
    try{const result=await send(req);if(!mounted.current||generation.current!==run)return;setMessage(result?.message??"Save unconfirmed. Draft kept.");if(result?.ok){setRetry(null);if(result.data?.kept){setShown(result.data.kept);setProposal(null);setPreview("");focusChooser.current=true;}}}
    catch{if(mounted.current)setMessage("Save unconfirmed. Draft kept; retry explicitly.");}
    finally{if(mounted.current&&generation.current===run){setBusy(false);locked.current=false;}}
  }
  function cancel(){generation.current++;setBusy(false);locked.current=false;setPreview("");setProposal(null);setSelected(new Set());setRetry(null);setMessage("Unkept image discarded.");void actions.imageEvidence?.({type:"cancel_evidence",request_id:crypto.randomUUID()});focusChooser.current=true;}
  return <section className="image-evidence" aria-label="Image evidence"><details><summary>Image evidence</summary><div className="image-evidence-body">
    <p>Local unshared maps only. Choose a PNG, JPEG or WebP still image, at most 5 MiB and 16 megapixels. Choosing and previewing send nothing.</p>
    <label>Choose image<input ref={chooser} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async event=>{
      const file=event.target.files?.[0];if(!file)return;const run=++generation.current;setPreview("");setProposal(null);setRetry(null);setMessage("Preparing preview…");
      try{const url=await prepareImage(file);if(mounted.current&&generation.current===run){setPreview(url);setShown(null);setMessage("Preview ready. Nothing sent.");}}
      catch(error){if(mounted.current&&generation.current===run)setMessage(error instanceof Error?error.message:"Invalid image.");}
      event.target.value="";
    }}/></label>
    <label>Target topic<select disabled={busy||!!proposal} value={target} onChange={e=>{setTarget(e.target.value);setTitle(map.threads.find(t=>t.id===e.target.value)?.title??"");setRetry(null);}}><option value="">Choose a topic</option>{map.threads.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
    {preview&&<figure><img src={preview} alt="Exact sanitized image for extraction"/><figcaption>Preview · metadata removed</figcaption></figure>}
    {preview&&<><p>This image and the chosen topic title go to the existing Meta service only when you press Extract.</p><button disabled={busy||!map.connected||!target} onClick={()=>void extract()}>Extract</button><button onClick={cancel}>Cancel image</button></>}
    {proposal&&<div><p>Model-proposed regions are suggestions, not proof. Select a point to show its region.</p>{proposal.points.map(point=><div key={point.index} className="image-evidence-point">
      <label><input type="checkbox" checked={selected.has(point.index)} onChange={e=>{setSelected(was=>{const next=new Set(was);if(e.target.checked)next.add(point.index);else next.delete(point.index);return next;});setRetry(null);}}/>Keep point {point.index+1}</label>
      <textarea aria-label={`Proposed point ${point.index+1}`} value={point.text} maxLength={280} disabled={busy} onFocus={()=>setRegion(point.region)} onChange={e=>{setProposal({...proposal,points:proposal.points.map(p=>p.index===point.index?{...p,text:e.target.value}:p)});setRetry(null);}}/>
      <p>{point.region?`Model-proposed region: ${point.region.join(", ")}`:"No precise region"}</p>
    </div>)}{region&&<div className="image-evidence-region"><img src={preview} alt="Selected point's original image"/><span style={{left:`${region[0]*100}%`,top:`${region[1]*100}%`,width:`${region[2]*100}%`,height:`${region[3]*100}%`}}/></div>}
      <button disabled={busy||!map.connected||!selected.size} onClick={()=>void save({type:"keep_evidence",request_id:crypto.randomUUID(),extraction_id:proposal.id,points:proposal.points.filter(p=>selected.has(p.index))})}>Keep selected</button>
    </div>}
    {retry&&!busy&&<button onClick={()=>void save(retry)}>Retry same request</button>}
    <p role="status">{message}</p>
    {!!records.length&&<details><summary>Kept image sources ({records.length})</summary>{records.map(record=><div key={record.request_id}><button onClick={()=>{setShown(record);setRegion(null);}}>{record.title} · kept by {record.actor}{record.removed?" · undone":""}</button></div>)}</details>}
    {shown&&<aside aria-label="Original image evidence"><h3>Original image · {shown.title}</h3><div className="image-evidence-region"><img src={`/evidence/${shown.image_id}`} alt="Kept original image"/>{region&&<span style={{left:`${region[0]*100}%`,top:`${region[1]*100}%`,width:`${region[2]*100}%`,height:`${region[3]*100}%`}}/>}</div><p>{shown.width} × {shown.height} · {shown.model} · Kept by {shown.actor}</p>{shown.points.map((p,i)=><div key={p.index}><blockquote>{p.text}</blockquote><button onClick={()=>setRegion(p.region)}>{p.region?"Show proposed region":"No precise region"}</button><button disabled={!map.thoughts.some(t=>t.id===shown.thought_ids[i])} onClick={()=>actions.openThought(shown.thought_ids[i])}>Open kept point</button></div>)}
      {!records.find(r=>r.request_id===shown.request_id)?.removed&&<button disabled={busy||!map.connected} onClick={()=>void save({type:"undo_evidence",request_id:crypto.randomUUID(),keep_id:shown.request_id})}>Undo kept points</button>}
      <button onClick={()=>{setShown(null);chooser.current?.focus();}}>Close original</button></aside>}
  </div></details></section>;
}
