#!/usr/bin/env python3
"""Build the title-pixel shot from existing, recorded square app frames."""
import json
from pathlib import Path
import sys
from PIL import Image, ImageStat

root=Path(sys.argv[1]).resolve()
assets=root/'wall-2-squares'
audit=json.loads((assets/'crops.json').read_text())
rows={r['image']:r for r in audit['accepted']+audit.get('selected',[]) if 'image' in r}
pools={False:[],True:[]}
for name,row in rows.items():
    brightness=ImageStat.Stat(Image.open(assets/name).convert('L').resize((1,1))).mean[0]
    if brightness<85 or brightness>170:
        pools[brightness>170].append({'image':'wall-2-squares/'+name,'id':row['feature']+':'+row.get('label',''),'light':brightness>170})
def varied(rows):
    first,rest,seen=[],[],set()
    for row in rows:
        feature=row['id'].split(':')[0]
        if feature in seen:rest.append(row)
        else:first.append(row);seen.add(feature)
    return first+rest
tiles=[{'image':'wall-2-squares/opening-square.jpg','id':'finished-repair-night','light':False}]+varied(pools[False])+varied(pools[True])
opening=json.loads((root/'wall-2-shots.json').read_text())['shots'][0]['opening']
shot={'kind':'wall','layout':'title','seconds':14,'columns':64,'rows':36,'gap':.7,'opening':opening,'tiles':tiles}
(root/'wall-3-shots.json').write_text(json.dumps({'shots':[shot]},indent=2)+'\n')
handoff={'kind':'titlemorph','variant':'short','fromTitle':True,'seconds':4.31}
(root/'wall-3-handoff.json').write_text(json.dumps({'shots':[handoff]},indent=2)+'\n')
print(f'Title pixels: 64×36 from {len(pools[False])+1} dark and {len(pools[True])} light recorded frames; 14 seconds')
