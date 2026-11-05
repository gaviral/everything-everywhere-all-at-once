#!/usr/bin/env python3
"""Build the title wall from a reviewed, OCR-screened allowlist of recorded frames."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
from PIL import Image, ImageStat

REJECT = re.compile(r"\brent\b|\bfees?\b|\bmom\b|\bdad\b|\bbirthday\b|\bpriya\b|\bmarcus\b|\bfamily\b|\.env|api\s*key|permission\s*denied|\bdisabled\b|local\s+example|no\s+model\s+calls|\bsuperclass\b|recorded\s+demonstrations|fictional\s+example", re.I)
ALLOW = {'crew','crew-more','draw','draw-back','part-dimensions','sketch-labels'}
EXCLUDE = {'0192-crew.jpg','0196-crew-more.jpg','0197-crew-more.jpg','0198-crew-more.jpg'}

def last_frame(clip, output):
    result = subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames','-of','json',str(clip)],capture_output=True,text=True,check=True)
    count = int(json.loads(result.stdout)['streams'][0]['nb_read_frames'])
    if not output.exists():
        subprocess.run(['ffmpeg','-v','error','-i',str(clip),'-vf',f'select=eq(n\\,{count-1})','-fps_mode','vfr','-frames:v','1',str(output)],check=True)
    return count-1

def opening(root, out):
    returns=sorted((root/'clips/session').glob('use-return*.mp4'),key=lambda p:p.stat().st_mtime)
    if returns:
        source=returns[-1];identity=hashlib.sha256(source.read_bytes()).hexdigest()[:12];image=out/f'opening-{source.stem}-{identity}.png'
        frame=last_frame(source,image)
        return image,{'sourceClip':str(source.relative_to(root)),'sourceFrame':frame,'placeholder':False}
    image=out/'opening-placeholder.png'
    # A single explicit replacement input. Exclude the old capture's timing header and footer.
    if not image.exists():
        Image.open(root/'wall-2-squares/opening.png').crop((0,150,1493,990)).resize((1920,1080),Image.Resampling.LANCZOS).save(image)
    return image,{'placeholder':True,'replaceWith':'last frame of clips/session/use-return*.mp4'}

def varied(rows):
    first,rest,seen=[],[],set()
    for row in rows:
        feature=row['id'].split(':')[0]
        if feature in seen:rest.append(row)
        else:first.append(row);seen.add(feature)
    return first+rest

def main():
    parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);parser.add_argument('--ocr',required=True,type=Path)
    args=parser.parse_args();root=args.root.resolve();out=root/'wall-4-assets';out.mkdir(exist_ok=True);(out/'tiles').mkdir(exist_ok=True)
    audit=json.loads((root/'wall-2-squares/crops.json').read_text())
    all_rows={r['image']:r for r in audit['accepted']+audit['selected'] if r.get('image')}
    candidates={name:row for name,row in all_rows.items() if row['feature'] in ALLOW and name not in EXCLUDE}
    first,source=opening(root,out)
    paths=[root/'wall-2-squares'/name for name in candidates]+[first]
    (out/'ocr-input.json').write_text(json.dumps(list(map(str,paths))))
    subprocess.run([str(args.ocr),str(out/'ocr-input.json'),str(out/'ocr.json')],check=True)
    recognised={r['file']:r['text'] for r in json.loads((out/'ocr.json').read_text())}
    pools={False:[],True:[]};rejected=[{'file':name,'reason':'outside the reviewed scene allowlist'} for name in all_rows if name not in candidates];approved=[]
    for name,row in candidates.items():
        path=root/'wall-2-squares'/name;text=recognised[str(path)];match=REJECT.search(text)
        if match:rejected.append({'file':name,'reason':match.group(0)});continue
        image=Image.open(path);mean=ImageStat.Stat(image.convert('L').resize((1,1))).mean[0]
        if not (mean<85 or mean>170):rejected.append({'file':name,'reason':'insufficient light/dark separation'});continue
        target=out/'tiles'/name;shutil.copyfile(path,target)
        spec={'image':str(target.relative_to(root)),'id':row['feature']+':'+row.get('label',''),'light':mean>170}
        pools[mean>170].append(spec);approved.append({'file':str(target.relative_to(root)),'text':text,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
    if REJECT.search(recognised[str(first)]):raise SystemExit('Opening input did not pass text review')
    module=importlib.util.spec_from_file_location('square_crops',Path(__file__).with_name('square-crops.py'));squares=importlib.util.module_from_spec(module);module.loader.exec_module(squares)
    image=Image.open(first).convert('RGB');crop,_,_=squares.busy_square(image);x,y,size=crop
    hero=out/'tiles/opening-square.png';image.crop((x,y,x+size,y+size)).resize((640,640)).save(hero)
    approved.append({'file':str(hero.relative_to(root)),'text':recognised[str(first)],'sha256':hashlib.sha256(hero.read_bytes()).hexdigest()})
    light=ImageStat.Stat(image.crop((x,y,x+size,y+size)).convert('L').resize((1,1))).mean[0]>128
    tiles=[{'image':str(hero.relative_to(root)),'id':'opening-board','light':light}]+varied(pools[False])+varied(pools[True])
    if min(len(pools[False])+int(not light),len(pools[True])+int(light))<9:raise SystemExit('Review needs at least nine approved light and dark frames')
    shot={'kind':'wall','layout':'title','seconds':14,'columns':64,'rows':36,'gap':.7,'review':'wall-4-assets/review.json','opening':{'image':str(first.relative_to(root)),'crop':crop,**source},'tiles':tiles}
    (root/'wall-4-shots.json').write_text(json.dumps({'shots':[shot]},indent=2)+'\n')
    (root/'wall-4-handoff.json').write_text(json.dumps({'shots':[{'kind':'titlemorph','variant':'short','fromTitle':True,'seconds':4.31}]},indent=2)+'\n')
    (out/'review.json').write_text(json.dumps({'approved':approved,'rejected':rejected,'opening':source,'openingText':recognised[str(first)]},indent=2)+'\n')
    print(f'Approved {len(tiles)} recorded frames; rejected {len(rejected)}; opening placeholder={source["placeholder"]}')

if __name__=='__main__':main()
