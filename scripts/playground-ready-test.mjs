// Deterministic lazy commit boundary: real React/Chrome, no core/models or fixture content exemption.
import assert from "node:assert/strict";
import { openPage, ready } from "./headless.mjs";
import { uiServer } from "./ui-server.mjs";
import { playgroundReady, playgroundState } from "./playground-probe.mjs";
for (const key of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD/i.test(key)) delete process.env[key];
process.env.PRECHECK_PAGES="all";
assert.equal(ready(), "", "Chrome and built UI required");
const html=String.raw`<!doctype html><div id="root"></div><script type="module">
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrickMount } from "/src/BrickSlot.tsx";
const root=createRoot(document.querySelector("#root"));
window.startCase=mode=>{
  const id="lazy-probe-"+mode;
  let resolve, reject;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no});
  const brick={info:{id,name:"Lazy probe",kind:"card"},load:()=>pending};
  const host={map:{},actionsFor:()=>({}),on:()=>()=>{},destination:null};
  window.releaseCase=()=>resolve({default:()=>mode==="null"?null:mode==="render-error"?(()=>{throw Error("Synthetic render failure")})():mode==="empty"?React.createElement("span",null," "):React.createElement("p",null,"Delayed card committed")});
  window.rejectCase=()=>reject(Error("Synthetic lazy load failure"));
  function Fixture(){const[committed,setCommitted]=useState("");return React.createElement("div",{className:"playground","data-errors":"0","data-brick-shown":id,"data-brick-ready":committed},React.createElement(BrickMount,{brick,host,onReady:setCommitted}));}
  root.render(React.createElement(Fixture,{key:id}));
  return id;
};
window.harnessReady=true;
</script>`;
const server=await uiServer({plugins:[{name:"lazy-commit-fixture",configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url!=="/lazy-commit-fixture")return next();
  res.setHeader("Content-Type","text/html");res.end(await server.transformIndexHtml(req.url,html));
});}}]},{port:0});
let browser;
try{
  await server.listen();const port=server.httpServer.address().port;assert.ok(port>=4620&&! [4360,4399].includes(port));
  browser=await openPage("http://127.0.0.1:"+port+"/lazy-commit-fixture");
  const{evaluate,until}=browser;assert.ok(await until("window.harnessReady===true",8000));
  for(const mode of ["delayed","null","empty","error","render-error"]){
    const id=await evaluate("startCase("+JSON.stringify(mode)+")");
    assert.ok(await until('document.querySelector(".playground")?.dataset.brickShown === '+JSON.stringify(id),8000));
    // Old selected/shown marker is already true, but the unresolved lazy tree cannot commit readiness.
    assert.equal(await evaluate(playgroundReady(id)),false,mode+": selected does not mean committed");
    assert.equal((await evaluate(playgroundState(id))).shows,false,mode+": fallback is empty");
    if(mode==="error"||mode==="render-error"){
      await evaluate(mode==="error"?"rejectCase()":"releaseCase()");assert.ok(await until('!!document.querySelector(".brick-broke")',8000));
      assert.equal(await evaluate(playgroundReady(id)),false,"failed lazy component never claims ready");
      assert.ok((await evaluate(playgroundState(id))).broke,"same generic error assertion still rejects broken components");
    }else{
      await evaluate("releaseCase()");assert.ok(await until(playgroundReady(id),8000),mode+": actual commit ready");
      const state=await evaluate(playgroundState(id));assert.equal(state.broke,"");assert.equal(state.errors,"0");assert.equal(state.mounted,true);
      assert.equal(state.shows,mode==="delayed",mode+": shared unchanged content predicate rejects null/empty despite ready");
      assert.ok(state.sideways<=1,"unchanged overflow predicate");
    }
  }
  console.log("playground-ready-test: PASS (deferred lazy is not ready before commit; ready null/empty still fail content; load error stays broken/not-ready)");
}finally{await browser?.close();await server.close();}
