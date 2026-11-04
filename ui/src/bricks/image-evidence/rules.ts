export const MAX_BYTES=5*1024*1024, MAX_PIXELS=16_000_000;
export function imageError(type:string,size:number,bytes:Uint8Array):string|null {
  if(size>MAX_BYTES||size<12)return "Choose a PNG, JPEG or WebP still image at most 5 MiB.";
  const png=bytes[0]===137&&new TextDecoder().decode(bytes.slice(1,4))==="PNG";
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
  if(!((type==="image/png"&&png)||(type==="image/jpeg"&&jpeg)||(type==="image/webp"&&webp)))return "Choose a PNG, JPEG or WebP still image. SVG and HTML are unavailable.";
  // Walk actual format chunks, never mistake arbitrary compressed pixels for a marker.
  let at=png?8:12;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(png||webp)while(at+8<=bytes.length){
    const length=view.getUint32(at+(png?0:4),!png);const name=new TextDecoder().decode(bytes.slice(at+(png?4:0),at+(png?8:4)));
    if((png&&name==="acTL")||(webp&&(name==="ANIM"||name==="ANMF"||(name==="VP8X"&&!!(bytes[at+8]&2)))))return "Animated images are unavailable. Choose a still image.";
    if(length>MAX_BYTES||at+(png?12:8)+length>bytes.length)return "Image file is incomplete.";
    at+=(png?12:8)+length+(webp?length%2:0);
  }
  return null;
}
export async function prepareImage(file:File):Promise<string>{
  if(file.size>MAX_BYTES)throw new Error("Choose an image at most 5 MiB.");
  const bytes=new Uint8Array(await file.arrayBuffer());const error=imageError(file.type,file.size,bytes);if(error)throw new Error(error);
  const bitmap=await createImageBitmap(file);
  try {
    if(bitmap.width*bitmap.height>MAX_PIXELS)throw new Error("Choose an image at most 16 megapixels.");
    const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext("2d");if(!context)throw new Error("Image preview unavailable.");
    context.drawImage(bitmap,0,0);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Image preview unavailable.")),"image/webp",1));
    if(blob.size>MAX_BYTES)throw new Error("Sanitized image exceeds 5 MiB. Choose a smaller image.");
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Image preview unavailable."));reader.readAsDataURL(blob);});
  } finally {bitmap.close();}
}
