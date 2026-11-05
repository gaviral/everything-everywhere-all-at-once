// Shared title geometry: the app-frame pixels and the following type use one layout.
export const TITLE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const TITLE_ROWS = ['EVERYTHING','EVERYWHERE','ALL AT ONCE'];
const WIDTH=1280;
function wordLayout(context,text,size) {
  let cursor=0;
  const letters=[...text].flatMap((char,index)=>{
    if(char===' '){cursor+=size*.34;return [];}
    if(index>0&&text[index-1]!==' ')cursor-=size*.04;
    const width=context.measureText(char).width,x=cursor+width/2;cursor+=width;
    return [{char,index,x}];
  });
  return {width:cursor,letters};
}
export function titleLayout(context) {
  context.font=`650 120px ${TITLE_FONT}`;context.textAlign='center';
  const fontSize=120*WIDTH/Math.max(...TITLE_ROWS.map(text=>wordLayout(context,text,120).width));
  const font=`650 ${fontSize}px ${TITLE_FONT}`;context.font=font;
  const letters=TITLE_ROWS.flatMap((text,row)=>{
    const {width,letters}=wordLayout(context,text,fontSize);
    return letters.map(({char,index,x})=>{
      const ink=context.measureText(char);
      return {row,index,char,x:960-width/2+x,y:315+row*225,
        height:ink.actualBoundingBoxAscent+ink.actualBoundingBoxDescent,
        baseline:(ink.actualBoundingBoxAscent-ink.actualBoundingBoxDescent)/2};
    });
  });
  return {fontSize,font,letters};
}
export function paintTitle(context,colour='#fff') {
  const layout=titleLayout(context);context.fillStyle=colour;context.textAlign='center';
  for(const letter of layout.letters)context.fillText(letter.char,letter.x,letter.y+letter.baseline);
}
export function paintRecorded(context,caption='Recorded demonstrations') {
  if(!caption)return;
  context.font=`500 21px ${TITLE_FONT}`;context.textAlign='center';context.textBaseline='middle';
  const width=context.measureText(caption).width+28;
  context.fillStyle='#000c';context.beginPath();context.roundRect(960-width/2,1025,width,39,5);context.fill();
  context.fillStyle='#fff';context.fillText(caption,960,1044.5);context.textBaseline='alphabetic';
}
export function titleCard(caption,background='#000',colour='#fff') {
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  const context=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
  context.fillStyle=background;context.fillRect(0,0,1920,1080);paintTitle(context,colour);paintRecorded(context,caption);
  return canvas;
}
