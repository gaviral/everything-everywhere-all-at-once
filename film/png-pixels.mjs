// Decode the opaque 8-bit RGB/RGBA PNGs produced by the renderer for pixel checks.
import { inflateSync } from 'node:zlib';
const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
export function pngPixels(png) {
  if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Expected PNG');
  let width,height,channels;const chunks=[];
  for(let at=8;at<png.length;){
    const size=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8),data=png.subarray(at+8,at+8+size);
    if(type==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===2?3:data[9]===6?4:0;
      if(data[8]!==8||!channels||data[12]!==0)throw Error('Expected noninterlaced 8-bit RGB/RGBA PNG');
    }
    if(type==='IDAT')chunks.push(data);
    at+=size+12;
  }
  const stride=width*channels,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});
  const pixels=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];if(filter>4)throw Error('Unknown PNG filter');
    for(let x=0;x<stride;x++){
      const at=y*stride+x,a=x>=channels?pixels[at-channels]:0,b=y?pixels[at-stride]:0,c=y&&x>=channels?pixels[at-stride-channels]:0;
      const add=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
      pixels[at]=(raw[y*(stride+1)+x+1]+add)&255;
    }
  }
  const rgb=Buffer.alloc(width*height*3+8);rgb.writeUInt32BE(width,0);rgb.writeUInt32BE(height,4);
  for(let i=0;i<width*height;i++){
    if(channels===4&&pixels[i*channels+3]!==255)throw Error('Expected opaque frame');
    rgb[8+i*3]=pixels[i*channels];rgb[9+i*3]=pixels[i*channels+1];rgb[10+i*3]=pixels[i*channels+2];
  }
  return rgb;
}
