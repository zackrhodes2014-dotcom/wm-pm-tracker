// Data model. Every entity has a stable id; names are attributes. Logs reference IDs only.
// Soft-delete: {archived:true, deletedAt, deletedBy}. Renames push {name, at, by} to nameHistory.
import * as S from './storage.js';
export const OWNER='Zach Rhodes';
export const st=()=>S.get();
export const rid=p=>p+'_'+(crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,12):Math.random().toString(36).slice(2,14));
const ord=(a,b)=>(a.order??0)-(b.order??0);
export const byId=(coll,id)=>st()[coll].find(x=>x.id===id);
export const loc=id=>byId('locations',id),area=id=>byId('areas',id),unit=id=>byId('units',id),size=id=>byId('sizes',id);
export const locations=(all)=>st().locations.filter(l=>all||!l.archived).sort(ord);
export const areasOf=(lid,all)=>st().areas.filter(a=>a.locationId===lid&&(all||!a.archived)).sort(ord);
export const unitsOf=(aid,all)=>st().units.filter(u=>u.areaId===aid&&(all||!u.archived)).sort(ord);
export const sizes=(kind,all)=>st().sizes.filter(s=>s.kind===kind&&(all||!s.archived)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
export const sizeName=id=>{const s=size(id);return s?s.name+(s.archived?' (removed)':''):'?'};
export const isGone=u=>{if(!u)return true;const a=area(u.areaId),l=a&&loc(a.locationId);return !!(u.archived||a?.archived||l?.archived)};
export const templatesFor=l=>st().templates.filter(t=>!t.locations||t.locations.includes(l.id));
export const tmpl=id=>st().templates.find(t=>t.id===id)||(id==='schedule'?{id,fields:[],extra:[],label:'Scheduled PM'}:{fields:['filters','belts','ops'],extra:[],label:'?'});
const stampE=(e,by)=>{e.updatedAt=S.now();e.updatedBy=by};

// ---- visit items (reference unitId; names resolve at render) ----
export function itemFor(u){return {id:u.id,unitId:u.id,kind:'unit'}}
// template.units (explicit list) wins; otherwise a unit with templateOnly[] only appears in those templates.
export const unitInTemplate=(u,t)=>t.units?t.units.includes(u.id):(!u.templateOnly||u.templateOnly.includes(t.id));
export function newVisit(lid,templateId,label,date,by){
  const t=tmpl(templateId),items=[];
  for(const a of areasOf(lid).filter(a=>!a.system)){if(!t.noUnits)unitsOf(a.id).filter(u=>unitInTemplate(u,t)).forEach(u=>items.push(itemFor(u)));
    t.extra.forEach((x,i)=>items.push({id:a.id+'~'+t.id+'~'+i,kind:'task',areaId:a.id,name:x}))}
  const v={id:rid('v'),locationId:lid,templateId,label:label||t.label,date:date||today(),status:'active',items,records:{},createdBy:by,updatedAt:S.now(),updatedBy:by};
  st().visits.push(v);st().currentVisit[lid]=v.id;S.logChange('visit',v.id,'create',{label:v.label,date:v.date,templateId},by);S.save();return v}
export function currentVisit(lid){const s=st();return s.visits.find(x=>x.id===s.currentVisit[lid])||s.visits.filter(x=>x.locationId===lid).pop()}
export const itemArea=it=>it.kind==='unit'?unit(it.unitId)?.areaId:it.areaId;
export const itemName=it=>{if(it.kind!=='unit')return it.name;const u=unit(it.unitId);return u?u.name+(isGone(u)?' (removed)':''):'(unknown unit)'};
export const itemGone=it=>it.kind==='unit'?isGone(unit(it.unitId)):!!area(it.areaId)?.archived;
export const featureOn=(lid,f)=>{const d=fieldDef(f);return !d.feature||!!loc(lid)?.features?.[d.feature]};
// tfields: columns shown on the card (template fields, minus location-gated ones that are off)
export function tfields(v,it){return it.kind==='unit'?(it.fields||tmpl(v.templateId).fields).filter(f=>featureOn(v.locationId,f)):['done']}
// fields: the ones that apply to this unit (counted in progress / remaining)
export function fields(v,it){if(it.kind!=='unit')return ['done'];const u=unit(it.unitId)||{checks:{}};
  return tfields(v,it).filter(f=>u.checks?.[f]!==false&&!(f==='filters'&&!u.filters)&&!(f==='belts'&&!u.belts))}
// items shown: active visits hide archived; completed visits (history) show everything.
export function visibleItems(v,aid){return v.items.filter(it=>(v.status!=='active'||!itemGone(it))&&(!aid||itemArea(it)===aid))}
export const val=(v,it,f)=>v.records[it.id]?.[f]?.v;
export const itemDone=(v,it)=>{const f=fields(v,it);return f.length>0&&f.every(x=>val(v,it,x))};
export const itemStarted=(v,it)=>fields(v,it).some(f=>val(v,it,f));
export const itemIssue=(v,it)=>!!val(v,it,'issue');
export const remaining=(v,it)=>!itemDone(v,it)||itemIssue(v,it);
export function stats(v,items){let done=0,issues=0,prog=0,last=null;
  for(const it of items){if(itemDone(v,it))done++;else if(itemStarted(v,it))prog++;if(itemIssue(v,it))issues++;
    for(const r of Object.values(v.records[it.id]||{}))if(!last||r.at>last.at)last=r}
  return {total:items.length,done,issues,prog,left:items.length-done-prog,pct:items.length?Math.round(done*100/items.length):0,last}}
// Parts totals (ONE implementation: used by the Parts list and the Filter totals screen).
// Washable / unspecified-qty entries are listed separately (not mixed into the per-size counts).
export const specialSize=name=>/wash|unspec|unknown|\?/i.test(String(name||''));
const natSort=(a,b)=>String(a[0]).localeCompare(String(b[0]),undefined,{numeric:true});
export function partsList(v,items){const f={},b={},ff={},bb={},fs={},bs={};let units=0;
  for(const it of items){if(it.kind!=='unit')continue;const u=unit(it.unitId);if(!u||u.archived)continue;units++;const fl=v?fields(v,it):[];
    const openF=v&&fl.includes(partsField('filter')||'filters')&&!val(v,it,'filters'),openB=v&&fl.includes(partsField('belt')||'belts')&&!val(v,it,'belts');
    const add=(x,main,spec,left,open)=>{const k=sizeName(x.sizeId),q=+x.qty;if(specialSize(k)||!(q>0)){const key=specialSize(k)?k:`${k} (qty not given)`;spec[key]=(spec[key]||0)+(q>0?q:0);return}
      main[k]=(main[k]||0)+q;if(open)left[k]=(left[k]||0)+q};
    (u.filters||[]).forEach(x=>add(x,f,fs,ff,openF));(u.belts||[]).forEach(x=>add(x,b,bs,bb,openB))}
  const srt=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]||natSort(a,b));const sum=o=>Object.values(o).reduce((s,n)=>s+n,0);
  return {filters:srt(f),belts:srt(b),filtersLeft:ff,beltsLeft:bb,filtersSpecial:srt(fs),beltsSpecial:srt(bs),units,
    totals:{filters:sum(f),belts:sum(b),filtersSpecial:sum(fs),beltsSpecial:sum(bs)}}}
// every active unit at a location (or one area) as items - "whole PM" basis for totals
export function unitItems(lid,aid){return areasOf(lid).filter(a=>!a.system&&(!aid||a.id===aid)).flatMap(a=>unitsOf(a.id)).map(itemFor)}
export function logCount(kind,id){let n=0;const ids=new Set();
  if(kind==='units')ids.add(id);if(kind==='areas'){ids.add(id);st().units.filter(u=>u.areaId===id).forEach(u=>ids.add(u.id))}
  if(kind==='locations'){st().areas.filter(a=>a.locationId===id).forEach(a=>{ids.add(a.id);st().units.filter(u=>u.areaId===a.id).forEach(u=>ids.add(u.id))})}
  for(const v of st().visits)for(const it of v.items){const k=it.kind==='unit'?it.unitId:it.areaId;if(ids.has(k)||ids.has(it.id))n+=Object.keys(v.records[it.id]||{}).length}
  if(kind==='sizes')n=st().units.filter(u=>[...(u.filters||[]),...(u.belts||[])].some(x=>x.sizeId===id)).length;
  return n}
// ---- owner edits (all stamped + logged) ----
export function rename(coll,id,name,by){const e=byId(coll,id);name=name.trim();if(!name||name===e.name)return false;
  (e.nameHistory||=[]).push({name:e.name,at:S.now(),by});e.name=name;stampE(e,by);S.logChange(coll,id,'name',name,by);S.save();return true}
export function setAttr(coll,id,field,value,by){const e=byId(coll,id);e[field]=value;stampE(e,by);S.logChange(coll,id,field,value,by);S.save()}
function children(coll,id){if(coll==='locations')return st().areas.filter(a=>a.locationId===id).map(a=>['areas',a.id]);
  if(coll==='areas')return st().units.filter(u=>u.areaId===id).map(u=>['units',u.id]);return[]}
export function archive(coll,id,by,cascadeTag){const e=byId(coll,id);const tag=cascadeTag||id;
  if(!e.archived){e.archived=true;e.deletedAt=S.now();e.deletedBy=by;e.archivedWith=tag;stampE(e,by);S.logChange(coll,id,'archived',true,by)}
  children(coll,id).forEach(([c,i])=>archive(c,i,by,tag));S.save()}
export function restore(coll,id,by){const e=byId(coll,id);const tag=e.archivedWith||id;
  const go=(c,i)=>{const x=byId(c,i);if(x.archived&&(x.archivedWith===tag||x.id===id)){x.archived=false;x.restoredAt=S.now();x.restoredBy=by;delete x.archivedWith;stampE(x,by);S.logChange(c,i,'archived',false,by)}children(c,i).forEach(([cc,ii])=>go(cc,ii))};
  go(coll,id);// restoring a child of an archived parent restores the parents too
  if(coll==='units'){const a=area(e.areaId);if(a.archived)restore('areas',a.id,by)}if(coll==='areas'){const l=loc(e.locationId);if(l.archived)restore('locations',l.id,by)}S.save()}
export function move(coll,id,dir,by){const e=byId(coll,id);const sib=coll==='units'?unitsOf(e.areaId):coll==='areas'?areasOf(e.locationId):locations();
  sib.forEach((x,i)=>x.order=i);const i=sib.indexOf(e),j=i+dir;if(j<0||j>=sib.length)return;
  [sib[i].order,sib[j].order]=[j,i];[sib[i],sib[j]].forEach(x=>{stampE(x,by);S.logChange(coll,x.id,'order',x.order,by)});S.save()}
export function addLocation(name,by){const l={id:rid('loc'),name,sub:'',order:locations(true).length,nameHistory:[],createdBy:by};stampE(l,by);st().locations.push(l);S.logChange('locations',l.id,'create',l,by);S.save();return l}
export function addArea(lid,name,by){const a={id:rid('ar'),locationId:lid,name,order:areasOf(lid,true).length,nameHistory:[],createdBy:by};stampE(a,by);st().areas.push(a);S.logChange('areas',a.id,'create',a,by);S.save();return a}
export function addSize(kind,name,by){name=name.trim().toUpperCase();const ex=sizes(kind,true).find(s=>s.name===name);if(ex){if(ex.archived)restore('sizes',ex.id,by);return ex}
  const s={id:rid(kind==='filter'?'fs':'bs'),kind,name,nameHistory:[],createdBy:by};stampE(s,by);st().sizes.push(s);S.logChange('sizes',s.id,'create',s,by);S.save();return s}
// save unit (create or update). addToVisit: also append to the location's current open visit.
export function saveUnit(data,by,addToVisit){let u=data.id&&unit(data.id);const isNew=!u;
  if(isNew){u={id:rid('u'),order:unitsOf(data.areaId,true).length,nameHistory:[],flags:[],createdBy:by};st().units.push(u)}
  else if(data.name.trim()!==u.name)(u.nameHistory||=[]).push({name:u.name,at:S.now(),by});
  if(!isNew&&u.areaId!==data.areaId)u.order=unitsOf(data.areaId).length;
  Object.assign(u,{name:data.name.trim(),areaId:data.areaId,filters:data.filters,belts:data.belts,checks:data.checks});for(const k of ['asset','cadence','notes'])if(k in data){if(data[k])u[k]=data[k];else delete u[k]}if('equipmentGroupId' in data){if(data.equipmentGroupId)u.equipmentGroupId=data.equipmentGroupId;else delete u.equipmentGroupId}stampE(u,by);
  S.logChange('units',u.id,isNew?'create':'update',{name:u.name,areaId:u.areaId,filters:u.filters,belts:u.belts,checks:u.checks,equipmentGroupId:u.equipmentGroupId||null},by);
  if(isNew&&addToVisit){const lid=area(u.areaId).locationId,v=currentVisit(lid);if(v&&v.status==='active'&&!v.items.some(i=>i.unitId===u.id)){v.items.push(itemFor(u));v.updatedAt=S.now();v.updatedBy=by;S.logChange('visit',v.id,'addItem',u.id,by)}}
  S.save();return u}
export function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
// ---- seed: first run loads all; later seed versions only ADD entities whose id was never seen ----
export function applySeed(seed,by){let s=st();
  if(!s){s={locations:[],areas:[],units:[],sizes:[],templates:[],visits:[],currentVisit:{},seenSeedIds:[],seedVersion:0};S.init(s)}
  if((s.seedVersion||0)>=seed.version){migrateState(s,seed);return 0}const seen=new Set(s.seenSeedIds);let added=0;
  s.fieldDefs||=[];for(const coll of ['fieldDefs','locations','areas','units','sizes','templates'])for(const e of seed[coll]){const key=coll+':'+e.id;
    if(seen.has(key))continue;seen.add(key);if(!s[coll].some(x=>x.id===e.id)){s[coll].push({nameHistory:[],...structuredClone(e),updatedAt:seed.generatedAt,updatedBy:'seed'});added++}}
  s.seenSeedIds=[...seen];const first=!s.seedVersion;if(!first){migrateAreas(s,seed);migrateTemplates(s,seed);migrateBelts(s,seed);migrateUnitPatches(s,seed);migrateRetireUnits(s,seed);migrateGroups(s,seed);migrateTags(s,seed);migrateCheckmark(s,seed);migrateRename(s,seed);migrateTyson(s,seed);migrateTags(s,seed,'tysonTagMigration');migrateGroupRemove(s,seed);migrateState(s,seed)}s.seedVersion=seed.version;S.save();
  migrateState(s,seed);
  if(first)for(const l of locations())if(!s.visits.some(v=>v.locationId===l.id))newVisit(l.id,seed.defaultVisits?.[l.id]||'quarterly',null,null,by||'seed');
  return added}
export const fieldDef=id=>id==='done'?{id:'done',label:'Done',short:'Done'}:(st().fieldDefs.find(f=>f.id===id)||{id,label:id,short:id});
// partsField: which field "consumes" filter/belt parts (from fieldDefs[].parts)
export const partsField=kind=>st().fieldDefs.find(f=>f.parts===kind)?.id;

// ---- migration: merge old 'coil' (sheet COIL CLEAN) + 'condenser' (Condenser Coil Cleaned) into ONE field ----
export const MERGED='coilCondenser',OLD_FIELDS=['coil','condenser'];
export const MERGED_DEF={id:MERGED,label:'Condenser or Coil Cleaning',short:'Condenser or Coil Cleaning',feature:'condenserCoil',code:'CC'};
export function migrateState(s,seed){s=s||st();if(!s)return {};const out={records:0,units:0,templates:0};
  if((s.schemaVersion||0)<2){
    s.fieldDefs=(s.fieldDefs||[]).filter(f=>!OLD_FIELDS.includes(f.id));if(!s.fieldDefs.some(f=>f.id===MERGED))s.fieldDefs.push({...MERGED_DEF});
    (s.seenSeedIds||=[]);for(const k of ['fieldDefs:'+MERGED])if(!s.seenSeedIds.includes(k))s.seenSeedIds.push(k);
    for(const t of s.templates||[]){if(t.fields.some(f=>OLD_FIELDS.includes(f))){t.fields=[...new Set(t.fields.map(f=>OLD_FIELDS.includes(f)?MERGED:f))];out.templates++}}
    for(const u of s.units||[]){const c=u.checks||{};if(OLD_FIELDS.some(f=>f in c)){
      // N/A from sheet COIL CLEAN (coil:false) is respected; applies if either old one applied and coil was not N/A
      c[MERGED]=c.coil===false?false:(c.coil!==undefined?true:c.condenser!==false);delete c.coil;delete c.condenser;u.checks=c;out.units++}}
    for(const v of s.visits||[])for(const [iid,r] of Object.entries(v.records||{})){const old=OLD_FIELDS.filter(f=>r[f]);if(!old.length)continue;
      // keep the latest checked one as the value; keep every original record under mergedFrom (no loss)
      const recs=old.map(f=>({field:f,...r[f]}));const on=recs.filter(x=>x.v).sort((a,b)=>a.at<b.at?1:-1);const pick=on[0]||recs.sort((a,b)=>a.at<b.at?1:-1)[0];
      const prev=r[MERGED];const m={...pick};delete m.field;m.mergedFrom=[...(prev?[{field:MERGED,...prev}]:[]),...recs];if(prev&&prev.at>m.at&&prev.v){Object.assign(m,prev)}
      r[MERGED]=m;old.forEach(f=>delete r[f]);out.records++}
    s.schemaVersion=2}
  // schedules: add to existing locations that never received one (seed only ADDS; never overwrite owner edits)
  if(seed)for(const sl of seed.locations||[]){const l=s.locations.find(x=>x.id===sl.id);const key='schedule:'+sl.id;
    if(sl.schedule&&l&&!l.schedule&&!(s.seenSeedIds||[]).includes(key)){l.schedule=structuredClone(sl.schedule);s.seenSeedIds.push(key);out.schedule=true}
    const qk='quarterPlan:'+sl.id;if(sl.quarterPlan&&l&&!l.quarterPlan&&!(s.seenSeedIds||[]).includes(qk)){l.quarterPlan=structuredClone(sl.quarterPlan);s.seenSeedIds.push(qk);out.quarterPlan=true}}
  S.save();return out}


// ---- Quarterly PM picker (Hills only: location.quarterPlan). Jan Winter / Apr Spring / Jul Summer / Oct Fall.
// Each quarter = one visit (kind 'quarter') built from that quarter's templates and/or the groups the monthly schedule has
// due in that month. The month-by-month schedule engine is untouched (secondary "Monthly schedule" screen).
export const QUARTERS=[{q:1,m:1,name:'Winter',mon:'Jan'},{q:2,m:4,name:'Spring',mon:'Apr'},{q:3,m:7,name:'Summer',mon:'Jul'},{q:4,m:10,name:'Fall',mon:'Oct'}];
export const quarterOf=(d=new Date())=>Math.floor(d.getMonth()/3)+1;
export const quarterKey=(y,q)=>`${y}-Q${q}`;
export const quarterVisit=(lid,y,q)=>st().visits.find(v=>v.locationId===lid&&v.kind==='quarter'&&v.quarter===quarterKey(y,q));
export function quarterItems(lid,q){const l=loc(lid),plan=l?.quarterPlan?.[q]||{},items=[],seen=new Set(),push=it=>{if(!seen.has(it.id)){seen.add(it.id);items.push(it)}};
  for(const tid of plan.templates||[]){const t=tmpl(tid);if(!t)continue;for(const a of areasOf(lid).filter(a=>!a.system)){
    if(!t.noUnits)unitsOf(a.id).filter(u=>unitInTemplate(u,t)).forEach(u=>push({...itemFor(u),fields:[...t.fields],tpl:t.id}));
    t.extra.forEach((x,i)=>push({id:a.id+'~'+t.id+'~'+i,kind:'task',areaId:a.id,name:x,tpl:t.id}))}}
  let gc={};if(plan.schedule&&l.schedule){const m=QUARTERS[q-1].m;for(const g of groupsOf(lid)){const c=codesIn(g,m);if(c.length)gc[g.id]=[...c]}schedItems(lid,gc).forEach(push)}
  return {items,groupCodes:gc}}
export function startQuarterVisit(lid,y,q,by){let v=quarterVisit(lid,y,q);
  if(!v){const Q=QUARTERS[q-1],plan=loc(lid).quarterPlan[q],{items,groupCodes}=quarterItems(lid,q);
    v={id:rid('v'),kind:'quarter',quarter:quarterKey(y,q),locationId:lid,templateId:(plan.templates||[])[0]||'schedule',label:`${Q.name} PM ${y}`,date:`${y}-${String(Q.m).padStart(2,'0')}-01`,status:'active',items,groupCodes,records:{},createdBy:by,updatedAt:S.now(),updatedBy:by};
    st().visits.push(v);S.logChange('visit',v.id,'create',{kind:'quarter',quarter:v.quarter},by)}
  st().currentVisit[lid]=v.id;S.save();return v}
// quarter visit not finished after its quarter ended -> overdue (carry-over badge)
export function quarterOverdue(v,d=new Date()){if(!v||v.status!=='active')return false;const [y,q]=v.quarter.split('-Q').map(Number);const it=visibleItems(v);
  return (d.getFullYear()*4+quarterOf(d))>(y*4+q)&&!it.every(i=>itemDone(v,i))}
// ---- schedule (per location, optional): {source, sourceNote, legend:[{code,label}], groups:[{id,name,order,notes[],months:{1..12:[codes]},archived}]} ----
export const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const curMonth=()=>new Date().getMonth()+1;
export const monthKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
export const groupsOf=(lid,all)=>(loc(lid)?.schedule?.groups||[]).filter(g=>all||!g.archived).sort(ord);
export const group=(lid,gid)=>(loc(lid)?.schedule?.groups||[]).find(g=>g.id===gid);
export const codeLabel=(lid,c)=>(loc(lid)?.schedule?.legend||[]).find(x=>x.code===c)?.label||c;
export const codesIn=(g,m)=>g?.months?.[m]||[];
export const groupUnits=(lid,gid)=>areasOf(lid).flatMap(a=>unitsOf(a.id)).filter(u=>u.equipmentGroupId===gid);
export function defaultCodes(g){const all=Object.values(g.months||{}).flat();if(all.includes('PF'))return ['PF'];if(all.includes('PM'))return ['PM'];
  const c={};all.forEach(x=>c[x]=(c[x]||0)+1);const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];return top?[top[0]]:['PM']}
// code -> checklist field(s). Codes without a field become extra checklist (task) items.
export const CODE_FIELDS={PF:['filters','ops'],FC:['filters'],FS:['filters'],BC:['belts'],PM:['ops'],CA:['ops'],CC:[MERGED]};
export function codeFields(lid,codes){const f=[],extra=[];for(const c of codes){const m=CODE_FIELDS[c];
  if(m&&m.every(x=>featureOn(lid,x)))m.forEach(x=>f.includes(x)||f.push(x));else extra.push(c)}
  return {fields:['filters','belts','ops',MERGED].filter(x=>f.includes(x)),extra}}
function ensureSchedState(s){s.schedule||=(s.schedule={})}
// "checkmark" groups (e.g. Steam Boilers): no units - ONE tick per group per visit, codes due listed as its note.
export const isCheck=g=>g?.type==='checkmark';
export const checkAreaId=lid=>'ar_chk_'+lid;
export function ensureCheckArea(lid){const id=checkAreaId(lid);let a=st().areas.find(x=>x.id===id);
  if(!a){a={id,locationId:lid,name:'Plant equipment (check marks)',order:999,nameHistory:[],system:'checkmark',updatedAt:S.now(),updatedBy:'system'};st().areas.push(a)}
  if(a.archived)a.archived=false;return a}
export const checkItemId=gid=>'sch~'+gid+'~check';
function schedItems(lid,groupCodes){const items=[];
  for(const g of groupsOf(lid,true)){const codes=groupCodes[g.id];if(!codes?.length)continue;
    if(isCheck(g)){const a=ensureCheckArea(lid);items.push({id:checkItemId(g.id),kind:'task',check:true,areaId:a.id,groupId:g.id,codes:[...codes],name:g.name,note:'Due: '+codes.map(c=>`${c} (${codeLabel(lid,c)})`).join(', ')});continue}const us=groupUnits(lid,g.id);if(!us.length)continue;
    const {fields:f,extra}=codeFields(lid,codes);
    if(f.length)us.forEach(u=>items.push({id:u.id,unitId:u.id,kind:'unit',groupId:g.id,fields:f,codes:codes.filter(c=>CODE_FIELDS[c])}));
    extra.forEach(c=>items.push({id:'sch~'+g.id+'~'+c,kind:'task',areaId:us[0].areaId,groupId:g.id,code:c,name:`${g.name}: ${codeLabel(lid,c)} (${c})`}))}
  return items}
// one combined visit per location per month (all due codes stacked); resumes, never duplicates
export const monthVisit=(lid,mk=monthKey())=>st().visits.find(v=>v.locationId===lid&&v.kind==='month'&&v.month===mk);
export const hasTagged=lid=>groupsOf(lid).some(g=>isCheck(g)||groupUnits(lid,g.id).length);
export function ensureMonthVisit(lid,by,d=new Date()){const l=loc(lid);if(!l?.schedule||!hasTagged(lid))return null;const mk=monthKey(d);
  let v=monthVisit(lid,mk);const gc={};for(const g of groupsOf(lid)){const c=codesIn(g,d.getMonth()+1);if(c.length)gc[g.id]=[...c]}
  // nothing tagged is due this month -> no month visit (and the current visit is left alone)
  if(!v&&!schedItems(lid,gc).length)return null;
  let made=false;if(!v){made=true;const items=schedItems(lid,gc);v={id:rid('v'),kind:'month',month:mk,locationId:lid,templateId:'schedule',label:`${MONTHS[d.getMonth()]} ${d.getFullYear()} scheduled PM`,date:mk+'-01',status:'active',groupCodes:gc,items,records:{},createdBy:by,updatedAt:S.now(),updatedBy:by};
    st().visits.push(v);S.logChange('visit',v.id,'create',{kind:'month',month:mk},by)}
  else if(v.status==='active'){// newly tagged units join the open month visit
    for(const it of schedItems(lid,v.groupCodes))if(!v.items.some(x=>x.id===it.id))v.items.push(it)}
  // never hijack an open regular visit (e.g. Spring PM): the month visit becomes current only when nothing active is open
  // or the open one is an older schedule visit. Otherwise the location screen shows a banner to open it.
  const cur=currentVisit(lid);if(!cur||cur.status!=='active'||(made&&cur.templateId==='schedule'))st().currentVisit[lid]=v.id;S.save();return v}
// out-of-season / any-month group visit (no restriction)
export function startGroupVisit(lid,gid,codes,by,d=new Date()){const g=group(lid,gid);const due=codesIn(g,d.getMonth()+1);
  const oos=!codes.every(c=>due.includes(c));const items=schedItems(lid,{[gid]:codes});
  const v={id:rid('v'),kind:'group',groupId:gid,codes,outOfSeason:oos,locationId:lid,templateId:'schedule',label:`${g.name} · ${codes.join(', ')}`,date:today(),status:'active',groupCodes:{[gid]:codes},items,records:{},createdBy:by,updatedAt:S.now(),updatedBy:by};
  st().visits.push(v);st().currentVisit[lid]=v.id;S.logChange('visit',v.id,'create',{kind:'group',groupId:gid,codes,outOfSeason:oos},by);S.save();return v}
// month visits whose month ended incomplete -> overdue. An item/field is cleared by a LATER visit that checked the same unit+field
// for the same group (out-of-season work only clears overdue when it matches the missed group+code).
export function overdue(lid,mk=monthKey()){const res=[];
  for(const v of st().visits.filter(x=>x.locationId===lid&&x.kind==='month'&&x.month<mk)){const open=[];
    for(const it of visibleItems(v)){const fl=fields(v,it).filter(f=>!val(v,it,f)&&!clearedLater(lid,v,it,f));if(fl.length)open.push({it,fields:fl})}
    if(open.length)res.push({visit:v,open,groups:[...new Set(open.map(o=>o.it.groupId))]})}
  return res}
function clearedLater(lid,v,it,f){return st().visits.some(w=>w!==v&&w.locationId===lid&&(w.month||w.date.slice(0,7))>=v.month&&w.date>=v.date&&
  w.items.some(x=>x.id===it.id&&x.groupId===it.groupId&&(it.kind==='unit'?fields(w,x).includes(f)&&w.records[x.id]?.[f]?.v:w.records[x.id]?.done?.v)))}
export const groupOverdue=(lid,gid)=>overdue(lid).filter(o=>o.groups.includes(gid));
// ---- group manager (owner) ----
export function addGroup(lid,name,by){const l=loc(lid);l.schedule||={source:'',sourceNote:'',legend:[],groups:[]};const months={};for(let m=1;m<=12;m++)months[m]=[];
  const g={id:rid('eg'),name:name.trim(),order:l.schedule.groups.length,notes:[],months,archived:false,createdBy:by,updatedAt:S.now(),updatedBy:by};l.schedule.groups.push(g);stampE(l,by);S.logChange('schedule',lid+'/'+g.id,'create',g,by);S.save();return g}
export function updateGroup(lid,gid,patch,by){const g=group(lid,gid);if('name' in patch&&patch.name.trim()&&patch.name.trim()!==g.name)(g.nameHistory||=[]).push({name:g.name,at:S.now(),by});
  if(patch.name!==undefined)patch.name=patch.name.trim()||g.name;Object.assign(g,patch);g.updatedAt=S.now();g.updatedBy=by;if(patch.archived)Object.assign(g,{deletedAt:S.now(),deletedBy:by});
  if('type' in patch){if(isCheck(g))ensureCheckArea(lid);for(const v of st().visits)if(v.locationId===lid&&v.templateId==='schedule'&&v.status==='active'&&v.groupCodes?.[gid])refreshSchedVisit(v)}
  S.logChange('schedule',lid+'/'+gid,'update',patch,by);S.save();return g}
export function setMonthCodes(lid,gid,m,codes,by){const legend=new Set((loc(lid).schedule.legend||[]).map(x=>x.code));
  const bad=codes.filter(c=>!legend.has(c));if(bad.length)throw new Error('Unknown code: '+bad.join(', '));
  return updateGroup(lid,gid,{months:{...group(lid,gid).months,[m]:[...new Set(codes)]}},by)}

// ---- area migration (seed v5, Zach's Hills areas). Moves a unit only if it still sits in its ORIGINAL seed area
// (owner moves win). Renamed units keep their name (IDs are stable). Old guessed areas are archived only when empty
// AND untouched by the owner (never renamed / edited); otherwise they stay and are reported.
export function migrateAreas(s,seed){const m=seed.areaMigration;if(!m||(s.areaMigrationVersion||0)>=m.version)return null;const res={moved:0,kept:0,retired:[],keptAreas:[]};
  for(const [uid,{from,to}] of Object.entries(m.moves)){const u=s.units.find(x=>x.id===uid);if(!u)continue;
    if(u.areaId===from&&s.areas.some(a=>a.id===to)){u.areaId=to;u.order=s.units.filter(x=>x.areaId===to&&x!==u).length;u.updatedAt=S.now();u.updatedBy='seed-migration';S.logChange('units',uid,'areaId',to,'seed-migration');res.moved++}else if(u.areaId!==to)res.kept++}
  for(const aid of m.retireAreas){const a=s.areas.find(x=>x.id===aid);if(!a||a.archived)continue;
    const busy=s.units.some(u=>u.areaId===aid&&!u.archived),touched=(a.nameHistory||[]).length||(a.updatedBy&&a.updatedBy!=='seed');
    if(!busy&&!touched){Object.assign(a,{archived:true,deletedAt:S.now(),deletedBy:'seed-migration',archivedWith:aid});S.logChange('areas',aid,'archived',true,'seed-migration');res.retired.push(a.name)}else res.keptAreas.push(a.name)}
  s.areaMigrationVersion=m.version;s.lastAreaMigration=res;S.save();return res}

// ---- template migration (seed v6): fill the formerly-empty "Exhaust and Supply Fan PM" with the fall-sheet fans.
// Only touches a template that is still the untouched empty placeholder (noUnits && no units list).
export function migrateTemplates(s,seed){const m=seed.templateMigration;if(!m||(s.templateMigrationVersion||0)>=m.version)return;
  for(const [id,patch] of Object.entries(m)){if(id==='version')continue;const t=s.templates.find(x=>x.id===id);
    if(t&&t.noUnits&&!t.units){delete t.noUnits;delete t.emptyText;Object.assign(t,structuredClone(patch));t.updatedAt=S.now();t.updatedBy='seed-migration';S.logChange('templates',id,'units',t.units.length,'seed-migration')}}
  s.templateMigrationVersion=m.version;S.save()}

// ---- belt migration (seed v7): row 118 fan "B118 x 2?" -> Zach confirmed qty 2. Applied only if the owner never edited the unit.
export function migrateBelts(s,seed){const m=seed.beltMigration;if(!m||(s.beltMigrationVersion||0)>=m.version)return;
  for(const [uid,p] of Object.entries(m.units)){const u=s.units.find(x=>x.id===uid);
    if(u&&u.updatedBy==='seed'&&Array.isArray(u.belts)&&u.belts.length===0){u.belts=structuredClone(p.belts);u.notes=p.notes;u.flags=structuredClone(p.flags);u.checks={...u.checks,belts:true};S.logChange('units',uid,'belts',u.belts,'seed-migration')}}
  s.beltMigrationVersion=m.version;S.save()}

// ---- unit patch migration (seed v8): rows 118-120 fans - blank asset is normal: drop "(no asset)" from the name and the
// "No asset number" flag. Each field is changed only if it still equals the old seed value (owner edits win).
export function migrateUnitPatches(s,seed){const m=seed.unitPatchMigration;if(!m||(s.unitPatchMigrationVersion||0)>=m.version)return;
  for(const [uid,p] of Object.entries(m.units)){const u=s.units.find(x=>x.id===uid);if(!u)continue;
    for(const [k,old] of Object.entries(p.expect))if(JSON.stringify(u[k])===JSON.stringify(old)){u[k]=structuredClone(p.set[k]);S.logChange('units',uid,k,u[k],'seed-migration')}}
  s.unitPatchMigrationVersion=m.version;S.save()}

// ---- retire migration (seed v9): "Warehouse heater" decommissioned. Soft-deleted only if the owner never edited it.
export function migrateRetireUnits(s,seed){const m=seed.retireUnitMigration;if(!m||(s.retireUnitMigrationVersion||0)>=m.version)return;
  for(const uid of m.units){const u=s.units.find(x=>x.id===uid);if(u&&!u.archived&&u.updatedBy==='seed'&&!(u.nameHistory||[]).length){
    Object.assign(u,{archived:true,deletedAt:S.now(),deletedBy:'seed-migration',archivedWith:uid});S.logChange('units',uid,'archived',true,'seed-migration')}}
  s.retireUnitMigrationVersion=m.version;S.save()}

// ---- group migration (seed v10): add "Quarterly Supply Fans" to an existing Hills schedule (add-only) and tag the 8
// rooftop supply fans - only units still untouched by the owner (updatedBy seed/seed-migration) and untagged.
// v11: auto-tag Hills units to schedule groups. Only fills groups that are still EMPTY and units that have no group,
// so anything the owner already tagged/untagged by hand is left alone. Empty open schedule visits pick up the new units.
// v12: Zach's "just check marks" groups. Only groups the owner never typed AND that have no tagged units are converted.
// v13: spelling fix (AAON) + Tyson area rename. Only when the name is still the old seed value (owner renames kept). IDs unchanged.
// v16 (Nov 5 2026, Zach): remove 6 Hills schedule groups once, by id. Units are untagged (only equipmentGroupId cleared),
// the group record is kept in location.removedGroups for history. Safe if already deleted; a group Zach re-creates later
// gets a new id, so it is never removed again. Also archives EMPTY Hills areas whose names are not among the 13 real ones.
export function migrateGroupRemove(s,seed){const m=seed.groupRemoveMigration;if(!m)return;const l=s.locations.find(x=>x.id===m.locationId);if(!l)return;
  s.seenSeedIds||=[];const out={groups:[],untagged:0,areas:[]};
  for(const [gid,name] of Object.entries(m.groups)){const key='groupRemove:'+gid;if(s.seenSeedIds.includes(key))continue;s.seenSeedIds.push(key);
    const gs=l.schedule?.groups||[],i=gs.findIndex(g=>g.id===gid);
    if(i>=0){const [g]=gs.splice(i,1);(l.removedGroups||=[]).push({...g,removedAt:S.now(),removedBy:'seed-migration'});gs.forEach((x,k)=>x.order=k);out.groups.push(g.name);S.logChange('schedule',l.id+'/'+gid,'remove',{name:g.name},'seed-migration')}
    for(const u of s.units)if(u.equipmentGroupId===gid){u.equipmentGroupId=null;out.untagged++;S.logChange('units',u.id,'equipmentGroupId',null,'seed-migration')}
    for(const v of s.visits){if(v.locationId!==l.id)continue;if(v.groupCodes&&v.groupCodes[gid]){delete v.groupCodes[gid];if(v.status==='active')refreshSchedVisit(v)}}}
  const key='areaCleanup:'+m.version;if(!s.seenSeedIds.includes(key)){s.seenSeedIds.push(key);
    for(const a of s.areas)if(a.locationId===l.id&&!a.system&&!a.archived&&!m.keepAreaNames.includes(a.name)&&!(a.updatedBy&&!/^seed/.test(a.updatedBy))&&!s.units.some(u=>u.areaId===a.id&&!u.archived)){a.archived=true;out.areas.push(a.name);S.logChange('areas',a.id,'archived',true,'seed-migration')}}
  s.groupRemoveResult=out;return out}
export function migrateRename(s,seed){const m=seed.renameMigration;if(!m||(s.renameMigrationVersion||0)>=m.version)return;
  const ren=(e,r,coll)=>{if(e&&e.name===r.from){(e.nameHistory||=[]).push({name:e.name,at:S.now(),by:'seed-migration'});e.name=r.to;S.logChange(coll,e.id,'name',r.to,'seed-migration')}};
  for(const [id,r] of Object.entries(m.areas||{}))ren(s.areas.find(a=>a.id===id),r,'areas');
  for(const [id,r] of Object.entries(m.groups||{}))for(const l of s.locations)ren(l.schedule?.groups.find(g=>g.id===id),r,'schedule');
  for(const v of s.visits)for(const it of v.items)if(it.groupId&&it.check){const g=group(v.locationId,it.groupId);if(g)it.name=g.name}
  s.renameMigrationVersion=m.version}
// v13: Tyson RVAF + Wastewater real units. Sample units were retired (untouched only) by migrateRetireUnits. An untouched
// seed-made sample visit is replaced by a Tyson PM visit; a visit with work in it just gains the real units.
export function migrateTyson(s,seed){const m=seed.tysonMigration;if(!m||(s.tysonMigrationVersion||0)>=m.version)return;s.tysonMigrationVersion=m.version;
  const l=s.locations.find(x=>x.id===m.locationId);if(!l)return;if(l.placeholder&&!(l.updatedBy&&l.updatedBy!=='seed'))l.placeholder=false;
  const t=s.templates.find(x=>x.id===m.templateId);if(!t)return;
  for(const v of s.visits.filter(x=>x.locationId===l.id&&x.status==='active')){const touched=Object.values(v.records||{}).some(r=>Object.values(r||{}).some(f=>f?.v));
    if(!touched&&v.createdBy==='seed'&&v.items.every(i=>i.kind!=='unit'||m.sampleUnits.includes(i.unitId))){s.visits.splice(s.visits.indexOf(v),1);if(s.currentVisit[l.id]===v.id)delete s.currentVisit[l.id]}
    else for(const uid of m.units){const u=s.units.find(x=>x.id===uid);if(u&&!u.archived&&!v.items.some(i=>i.unitId===uid))v.items.push(itemFor(u))}}
  if(!s.visits.some(x=>x.locationId===l.id&&x.status==='active'))newVisit(l.id,m.templateId,null,null,'seed');S.save()}
export function migrateCheckmark(s,seed){const m=seed.checkmarkMigration;if(!m||(s.checkmarkMigrationVersion||0)>=m.version)return;
  const l=s.locations.find(x=>x.id===m.locationId);let any=false;
  for(const gid of m.groups){const g=l?.schedule?.groups.find(x=>x.id===gid);if(!g||g.type!==undefined||s.units.some(u=>u.equipmentGroupId===gid&&!u.archived))continue;
    g.type='checkmark';any=true;S.logChange('schedule',l.id+'/'+gid,'update',{type:'checkmark'},'seed-migration')}
  s.checkmarkMigrationVersion=m.version;if(any){ensureCheckArea(l.id);for(const v of s.visits)if(v.locationId===l.id&&v.templateId==='schedule'&&v.status==='active'&&v.groupCodes)refreshSchedVisit(v)}}
export function migrateTags(s,seed,key='tagMigration'){const m=seed[key];if(!m||(s[key+'Version']||0)>=m.version)return;
  const l=s.locations.find(x=>x.id===m.locationId);
  // the location's schedule must exist first (added only if it has none and was never seeded before)
  const sl=(seed.locations||[]).find(x=>x.id===m.locationId),sk='schedule:'+m.locationId;if(l&&!l.schedule&&sl?.schedule&&!(s.seenSeedIds||[]).includes(sk)){l.schedule=structuredClone(sl.schedule);s.seenSeedIds.push(sk);S.logChange('schedule',l.id,'create',{groups:sl.schedule.groups.length},'seed-migration')}const live=new Set((l?.schedule?.groups||[]).filter(g=>!g.archived).map(g=>g.id));
  const used=new Set(s.units.filter(u=>u.equipmentGroupId&&!u.archived).map(u=>u.equipmentGroupId));
  // units the seed just added carrying a group this install doesn't have (owner has their own schedule) -> untagged
  for(const [uid,gid] of Object.entries(m.tags||{})){const u=s.units.find(x=>x.id===uid);if(u&&u.equipmentGroupId===gid&&!live.has(gid)&&u.updatedBy==='seed'){delete u.equipmentGroupId}}
  for(const [uid,gid] of Object.entries(m.tags||{})){const u=s.units.find(x=>x.id===uid);if(!u||u.equipmentGroupId||!live.has(gid)||used.has(gid))continue;
    u.equipmentGroupId=gid;S.logChange('units',uid,'equipmentGroupId',gid,'seed-migration')}
  s[key+'Version']=m.version;
  for(const v of s.visits)if(v.locationId===m.locationId&&v.templateId==='schedule'&&v.status==='active'&&v.groupCodes)refreshSchedVisit(v)}
export function refreshSchedVisit(v){const want=schedItems(v.locationId,v.groupCodes);
  v.items=v.items.filter(x=>!x.groupId||want.some(w=>w.id===x.id)||Object.values(v.records[x.id]||{}).some(r=>r?.v));
  for(const it of want)if(!v.items.some(x=>x.id===it.id))v.items.push(it)}
// tag several units to one group at once (Tag units picker). Moves units from another group. Open schedule visits pick them up.
export function tagUnits(lid,gid,uids,by){for(const uid of uids){const u=unit(uid);if(!u||u.equipmentGroupId===gid)continue;
    u.equipmentGroupId=gid;u.updatedAt=S.now();u.updatedBy=by;S.logChange('units',uid,'equipmentGroupId',gid,by)}
  for(const v of st().visits)if(v.locationId===lid&&v.templateId==='schedule'&&v.status==='active'&&v.groupCodes)refreshSchedVisit(v);S.save()}
export function migrateGroups(s,seed){const m=seed.groupMigration;if(!m||(s.groupMigrationVersion||0)>=m.version)return;
  const l=s.locations.find(x=>x.id===m.locationId),key='group:'+m.group.id;
  if(l?.schedule&&!l.schedule.groups.some(g=>g.id===m.group.id)&&!s.seenSeedIds.includes(key)){l.schedule.groups.push({...structuredClone(m.group),order:l.schedule.groups.length});s.seenSeedIds.push(key);S.logChange('schedule',l.id+'/'+m.group.id,'create',m.group,'seed-migration')}
  if(l?.schedule?.groups.some(g=>g.id===m.group.id&&!g.archived))for(const uid of m.units){const u=s.units.find(x=>x.id===uid);
    if(u&&!u.equipmentGroupId&&['seed','seed-migration'].includes(u.updatedBy||'seed')){u.equipmentGroupId=m.group.id;S.logChange('units',uid,'equipmentGroupId',m.group.id,'seed-migration')}}
  s.groupMigrationVersion=m.version;S.save()}

// ---- Check all (unit or area): ticks every applicable, not-yet-checked field of the current checklist.
// Already-checked fields keep their stamp; units flagged ISSUE are skipped; notes/issue untouched.
export function checkAllPlan(v,items,only){const plan=[];let skipped=0;const fl=it=>fields(v,it).filter(f=>!only||f===only);
  for(const it of items){if(itemGone(it))continue;if(itemIssue(v,it)){if(fl(it).some(f=>!val(v,it,f)))skipped++;continue}
    for(const f of fl(it))if(!val(v,it,f))plan.push([it.id,f])}
  return {plan,skipped}}
export function checkAll(v,items,by,only){const {plan,skipped}=checkAllPlan(v,items,only);const undo=[];
  for(const [iid,f] of plan){const prev=v.records[iid]?.[f];undo.push([iid,f,prev?structuredClone(prev):null]);S.setField(v,iid,f,true,by)}
  return {ticked:plan.length,skipped,undo,visitId:v.id}}
export function undoCheckAll(res,by){const v=st().visits.find(x=>x.id===res.visitId);if(!v)return;for(const [iid,f,prev] of res.undo)S.restoreField(v,iid,f,prev,by)}
