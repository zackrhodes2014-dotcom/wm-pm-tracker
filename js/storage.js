// Small local-first storage module (localStorage). Every mutation is also appended to
// an outbox change log {id, entity, key, field, value, updatedAt, updatedBy} for sync.
const KEY='wmpm.state.v1', OUT='wmpm.outbox.v1', USER='wmpm.user';
let state=null;
export const now=()=>new Date().toISOString();
export function load(){try{state=JSON.parse(localStorage.getItem(KEY))}catch(e){state=null}return state}
export function get(){return state}
export function save(){localStorage.setItem(KEY,JSON.stringify(state))}
export function init(s){state=s;save()}
export function getUser(){return localStorage.getItem(USER)}
export function setUser(n){n?localStorage.setItem(USER,n):localStorage.removeItem(USER)}
export function outbox(){try{return JSON.parse(localStorage.getItem(OUT))||[]}catch(e){return[]}}
export function clearOutbox(ids){const s=new Set(ids);localStorage.setItem(OUT,JSON.stringify(outbox().filter(c=>!s.has(c.id))))}
export function logChange(entity,key,field,value,by){
  const c={id:Math.random().toString(36).slice(2)+Date.now().toString(36),entity,key,field,value,updatedAt:now(),updatedBy:by};
  const o=outbox();o.push(c);localStorage.setItem(OUT,JSON.stringify(o));return c}
// Set a field on a visit line item: stores {v, by, at} (updatedBy/updatedAt) and logs the change.
export function setField(visit,itemId,field,value,by){
  const rec=(visit.records[itemId]||={});const at=now();
  rec[field]={v:value,by,at};visit.updatedAt=at;visit.updatedBy=by;
  logChange('record',visit.id+'/'+itemId,field,value,by);save();return rec[field]}
// Edit the time on an existing check stamp. Keeps who (current user per spec), originalLoggedAt, editedAt/By, history.
export function editStampTime(visit,itemId,field,newIso,by){
  const rec=visit.records[itemId]?.[field];if(!rec)throw new Error('No stamp to edit');
  const t=Date.parse(newIso);if(isNaN(t))throw new Error('Invalid date/time');
  if(t>Date.now()+1000)throw new Error('Time can’t be in the future');
  const iso=new Date(t).toISOString();rec.originalLoggedAt||=rec.at;
  (rec.history||=[]).push({from:rec.at,to:iso,editedAt:now(),editedBy:by});
  rec.at=iso;rec.editedAt=now();rec.editedBy=by;rec.by=by;visit.updatedAt=now();visit.updatedBy=by;
  logChange('record',visit.id+'/'+itemId,field+'.at',{at:iso,originalLoggedAt:rec.originalLoggedAt,editedAt:rec.editedAt,editedBy:by},by);save();return rec}
