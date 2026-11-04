#!/usr/bin/env python3
"""Select detailed, distinct square crops from recorded app states. Pillow + NumPy.
No image generation: every output pixel comes from its recorded source frame.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageOps, ImageDraw


def integral(values):
    return np.pad(values.cumsum(0).cumsum(1), ((1, 0), (1, 0)))


def area(table, x, y, side):
    return table[y+side, x+side]-table[y, x+side]-table[y+side, x]+table[y, x]


def busy_square(image, reference=None):
    small = image.convert('L').resize((480, 270))
    gray = np.asarray(small, dtype=np.float32)
    edge = np.zeros_like(gray)
    edge[:, 1:] += np.abs(np.diff(gray, axis=1))
    edge[1:, :] += np.abs(np.diff(gray, axis=0))
    mask = edge > 17
    table = integral(mask.astype(float))
    changed = np.abs(gray-reference)>20 if reference is not None else np.zeros_like(mask)
    if changed.sum()<70: changed[:]=False
    changes=integral(changed.astype(float))
    best = None
    for side in [90, 110, 130, 150, 180, 210, 240]:
        for y in range(16, 258-side, 8):
            for x in range(4, 477-side, 8):
                density = area(table, x, y, side)/(side*side)
                score = density * (side/150)**.45 + .7*area(changes,x,y,side)/(side*side)
                if best is None or score > best[0]:
                    best = (score, x, y, side, density)
    _, x, y, side, density = best
    patch = mask[y:y+side,x:x+side]
    occupied = np.mean([part.mean()>.012 for row in np.array_split(patch,6) for part in np.array_split(row,6,axis=1)])
    return [x*4,y*4,side*4], float(density), float(occupied)


def describe(image, crop):
    x,y,side = crop
    square = image.crop((x,y,x+side,y+side)).convert('RGB')
    small = np.asarray(square.resize((40,40)),dtype=np.int16)
    gray = np.asarray(square.convert('L').resize((9,8)),dtype=np.int16)
    bits = (gray[:,1:]>gray[:,:-1]).flatten()
    return square, small, bits, float(np.median(small)), hashlib.sha256(square.tobytes()).hexdigest()


def extract(clip, at, destination):
    if not destination.exists():
        subprocess.run(['ffmpeg','-v','error','-ss',str(at),'-i',str(clip),'-frames:v','1',str(destination)],check=True)


def source_rows(roots):
    rows=[]
    for root in roots:
        for report in root.glob('capture*.json'):
            data=json.loads(report.read_text())
            for feature in data['features']:
                for state in feature.get('states',[]):
                    if feature['id'] in {'advisor','topic-brief'} and state['label']=='input':
                        continue
                    rows.append(dict(state,feature=feature['id'],source=root/state['file']))
    return rows


def select(rows, output):
    accepted, rejected, thumbnails, hashes, exact = [], [], [], [], set()
    reference={}
    for row in rows:
        im=Image.open(row['source']).convert('RGB')
        crop,density,coverage=busy_square(im,reference.get(row['feature']))
        reference.setdefault(row['feature'],np.asarray(im.convert('L').resize((480,270)),dtype=np.float32))
        square,thumb,bits,median,digest=describe(im,crop)
        reason=None
        if density<.022 or coverage<.42: reason='mostly empty after square crop'
        elif digest in exact: reason='identical square pixels'
        else:
            for previous,oldbits in zip(thumbnails,hashes):
                difference=float(np.abs(thumb-previous).mean())
                if difference<4.5 or (np.count_nonzero(bits!=oldbits)<7 and difference<13):
                    reason='visually repeated state';break
        record={**{k:str(v) if isinstance(v,Path) else v for k,v in row.items()},'crop':crop,'density':density,'coverage':coverage,'brightness':median,'sha256':digest}
        if reason: rejected.append(dict(record,reason=reason));continue
        name=f'{len(accepted):04d}-{row["feature"]}.jpg'
        square.resize((640,640),Image.Resampling.LANCZOS).save(output/name,quality=94)
        record['image']=name
        accepted.append(record);thumbnails.append(thumb);hashes.append(bits);exact.add(digest)
    return accepted,rejected


def sheet(rows,root,destination):
    cols=12; side=120
    canvas=Image.new('RGB',(cols*side,((len(rows)+cols-1)//cols)*side),'white')
    for i,row in enumerate(rows):
        im=Image.open(root/row['image']).resize((side,side))
        canvas.paste(im,(i%cols*side,i//cols*side))
    canvas.save(destination,quality=92)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('output',type=Path)
    parser.add_argument('roots',nargs='+',type=Path)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    rows=source_rows(args.roots)
    accepted,rejected=select(rows,args.output)
    (args.output/'crops.json').write_text(json.dumps({'accepted':accepted,'rejected':rejected},indent=2)+'\n')
    sheet(accepted,args.output,args.output/'accepted.jpg')
    lights=sum(r['brightness']>=125 for r in accepted)
    print(f'{len(rows)} recorded states: {len(accepted)} distinct detailed squares ({lights} light); {len(rejected)} rejected')


if __name__=='__main__': main()
