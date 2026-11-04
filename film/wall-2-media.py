#!/usr/bin/env python3
"""Prepare actual recorded states, square crops, selected loops and a film manifest."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

spec=importlib.util.spec_from_file_location('squares',Path(__file__).with_name('square-crops.py'))
squares=importlib.util.module_from_spec(spec);spec.loader.exec_module(squares)


def video_states(media):
    root=media/'wall-2-video-states';root.mkdir(exist_ok=True)
    times={'think':[3,5,7,9], 'ask':[2.8,5,7.5,9.9], 'draw':[5,9,13,17,21,25,28.8],
      'draw-back':[2,11.9,13.8], 'crew':[3,6,9,12,14,16,18],
      'crew-more':[5,10,15,20,25,29,32,34], 'flow':[6,12,18,24,28,31,34.8], 'parts':[2,4.8,7.6,10]}
    rows=[]
    for name,points in times.items():
        activity='draw' if name.startswith('draw') else 'build' if name in ['crew','crew-more','parts'] else 'understand'
        if not all((root/f'{name}-{i}.png').exists() for i in range(len(points))):
            select='+'.join(f'eq(n\\,{round(at*30)})' for at in points)
            subprocess.run(['ffmpeg','-v','error','-i',str(media/'clips'/f'{name}.mp4'),'-vf',f'select={select}',
                '-fps_mode','vfr','-start_number','0',str(root/f'{name}-%d.png')],check=True)
        for i,at in enumerate(points):
            file=root/f'{name}-{i}.png'
            rows.append(dict(feature=name,activity=activity,label=f'recorded {at}s',source=file))
    return rows


def main():
    media=Path(sys.argv[1]).resolve();out=media/'wall-2-squares';out.mkdir(exist_ok=True)
    roots=[media/x for x in ['wall-2-raw','wall-2-actions','wall-2-options','wall-2-deep','wall-2-dimensions','wall-2-topics','wall-2-readings','wall-2-workflows']]
    rows=squares.source_rows(roots)+video_states(media)
    accepted,rejected=squares.select(rows,out)
    opening=out/'opening.png'
    if not opening.exists(): squares.extract(media/'clips/crew-more.mp4',34.7666666667,opening)
    image=squares.Image.open(opening)
    crop,_,_=squares.busy_square(image)
    opening_square,_,_,_,digest=squares.describe(image,crop)
    opening_square.resize((640,640)).save(out/'opening-square.jpg',quality=94)
    hero=dict(image='opening-square.jpg',feature='repair-night-board',activity='build',sha256=digest)
    # Keep one distinctive moving excerpt in each activity that has recorded footage.
    excerpts={'crew':(14,4),'parts':(2,6),'draw':(22.5,7),'draw-back':(11,3),'ask':(3,6),'flow':(29,6)}
    loops=[]
    for name,(start,duration) in excerpts.items():
        choices=[r for r in accepted if r['feature']==name]
        if not choices: continue
        chosen=choices[-1];x,y,side=chosen['crop'];file=f'{name}-loop.mp4'
        if not (out/file).exists():
            subprocess.run(['ffmpeg','-v','error','-ss',str(start),'-i',str(media/'clips'/f'{name}.mp4'),'-t',str(duration),
                '-vf',f'crop={side}:{side}:{x}:{y},scale=640:640','-r','30','-an','-c:v','libx264','-preset','fast','-crf','18',str(out/file)],check=True)
        loops.append(dict(chosen,clip=file,loopSeconds=duration))
        accepted.remove(chosen)
    # Largest complete mosaic supported by distinct material; never duplicate to reach a count.
    light=[r for r in accepted if r['brightness']>=125]
    dark=[r for r in accepted if r['brightness']<125]
    available=len(light)+min(len(dark)+len(loops)+1,len(light)//2)
    count=min(300,144+3*((available-144)//3))
    (out/'candidate-audit.json').write_text(json.dumps({'accepted':accepted,'rejected':rejected},indent=2)+'\n')
    if count<201: raise SystemExit(f'Need more distinct states: {len(light)} light, {len(dark)} dark, {len(loops)} loops; no padded wall written')
    dark_limit=count//3-len(loops)-1
    selected=light[:count-len(loops)-1]+dark[:max(0,dark_limit)]
    selected=selected[:count-len(loops)-1]
    if len(selected)<count-len(loops)-1: raise SystemExit('Insufficient light material for the one-third dark limit')
    order={'build':0,'understand':1,'draw':2,'organize':3}
    lead=[r for r in loops if r['activity']=='build']
    selected=lead+sorted(selected+[r for r in loops if r not in lead],key=lambda r:(order.get(r['activity'],3),r['feature'],r.get('label','')))
    tiles=[{'image':'wall-2-squares/opening-square.jpg','id':'repair-night-board','activity':'build'}]
    for row in selected:
        tile={'id':row['feature']+':'+row.get('label',''),'activity':row['activity']}
        if 'clip' in row:tile.update(clip='wall-2-squares/'+row['clip'],loopSeconds=row['loopSeconds'])
        else:tile['image']='wall-2-squares/'+row['image']
        tiles.append(tile)
    assert len(tiles)==count
    shot={'kind':'wall','layout':'field','seconds':13,'gap':2,'opening':{'image':'wall-2-squares/opening.png','crop':crop,'sourceClip':'clips/crew-more.mp4','sourceSeconds':34.7666666667},'tiles':tiles}
    (media/'wall-2-shots.json').write_text(json.dumps({'shots':[shot]},indent=2)+'\n')
    (out/'crops.json').write_text(json.dumps({'accepted':accepted,'rejected':rejected,'selected':selected,'total':count},indent=2)+'\n')
    squares.sheet(selected,out,out/'selected.jpg')
    (out/'REJECTED.md').write_text('# Rejected recorded states\n\n'+'\n'.join(f'- {Path(r["source"]).name}: {r["reason"]}' for r in rejected)+'\n')
    print(f'{count} distinct squares; {len(loops)} real loops; {sum(r["brightness"]<125 for r in selected)+1} dark; {len(rejected)} rejected')


if __name__=='__main__':main()
