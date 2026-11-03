// CSV import: columns location,area,unit (header optional, quoted fields ok). Uses model IDs; replace = soft-delete.
import * as M from './model.js';
export function parseCsv(txt){
  const rows=[];for(const line of txt.split(/\r?\n/)){if(!line.trim())continue;const o=[];let c='',q=false;
    for(let i=0;i<line.length;i++){const ch=line[i];if(q){if(ch=='"'&&line[i+1]=='"'){c+='"';i++}else if(ch=='"')q=false;else c+=ch}else if(ch=='"')q=true;else if(ch==','){o.push(c);c=''}else c+=ch}
    o.push(c);rows.push(o.map(s=>s.trim()))}
  if(rows.length&&rows[0][0].toLowerCase()==='location')rows.shift();
  const bad=rows.findIndex(r=>r.length<3||!r[0]||!r[1]||!r[2]);if(bad>=0)throw new Error(`Row ${bad+1}: need location,area,unit`);
  if(!rows.length)throw new Error('No rows found');return rows.map(([location,area,unit])=>({location,area,unit}));
}
export function applyImport(rows,mode,by){let added=0,removed=0,newLocations=0;const keep=new Set(),touched=new Set();const lc=s=>s.toLowerCase();
  for(const r of rows){let l=M.locations().find(x=>lc(x.name)===lc(r.location));if(!l){l=M.addLocation(r.location,by);newLocations++}touched.add(l.id);
    let a=M.areasOf(l.id).find(x=>lc(x.name)===lc(r.area));if(!a)a=M.addArea(l.id,r.area,by);
    let u=M.unitsOf(a.id).find(x=>lc(x.name)===lc(r.unit));
    if(!u){u=M.saveUnit({name:r.unit,areaId:a.id,filters:[],belts:[],checks:{filters:true,belts:true,coilCondenser:true,ops:true}},by,true);added++}keep.add(u.id)}
  if(mode==='replace')for(const lid of touched){M.st().units.filter(u=>!u.archived&&M.area(u.areaId)?.locationId===lid&&!keep.has(u.id)).forEach(u=>{M.archive('units',u.id,by);removed++});
    const l=M.loc(lid);if(l.placeholder)M.setAttr('locations',lid,'placeholder',false,by)}
  return {rows:rows.length,added,removed,newLocations}}
