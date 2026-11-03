// Sync adapter interface. An adapter implements:
//   name: string, localOnly: boolean
//   push(changes[]) -> Promise<{acked: id[]}>    send queued outbox changes
//   pull(sinceISO)  -> Promise<changes[]>        remote changes since a point in time
// The app always writes locally first; the adapter only moves the outbox.
// Merge rule: last-write-wins PER FIELD, comparing updatedAt (ISO strings, ties -> updatedBy name order).

export function lwwMerge(local, remote){
  // local/remote: {field: {v, by, at}} -> merged copy, field by field
  const out={...local};
  for(const [f,r] of Object.entries(remote||{})){
    const l=out[f];
    if(!l || r.at>l.at || (r.at===l.at && (r.by||'')>(l.by||''))) out[f]=r;
  }
  return out;
}

// Zero-infrastructure default: nothing leaves the device.
export const LocalOnlyAdapter={name:'local',localOnly:true,
  async push(){return {acked:[]}}, async pull(){return []}};

/* ---------- SKELETON (not wired up, not tested) : Firebase Firestore ----------
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
export function FirebaseAdapter(config){
  const db=getFirestore(initializeApp(config));
  return {name:'firebase',localOnly:false,
    async push(changes){
      for(const c of changes){
        // one doc per record key; per-field LWW enforced client-side + optional security rule
        // that rejects writes whose updatedAt is older than the stored field's updatedAt.
        await setDoc(doc(db,'records',c.key.replace('/','__')),
          {[c.field]:{v:c.value,by:c.updatedBy,at:c.updatedAt}},{merge:true});
      }
      return {acked:changes.map(c=>c.id)};
    },
    async pull(since){ const q=query(collection(db,'changes'),where('updatedAt','>',since));
      return (await getDocs(q)).docs.map(d=>d.data()); }};
}
---------- SKELETON : Supabase (Postgres) ----------
import { createClient } from '@supabase/supabase-js';
// table changes(id text pk, entity text, key text, field text, value jsonb,
//               updated_at timestamptz, updated_by text)
// view  field_state = latest row per (key, field) ordered by updated_at desc  (LWW)
export function SupabaseAdapter(url, anonKey){
  const sb=createClient(url,anonKey);
  return {name:'supabase',localOnly:false,
    async push(changes){ const {error}=await sb.from('changes').upsert(changes.map(c=>({
        id:c.id,entity:c.entity,key:c.key,field:c.field,value:c.value,updated_at:c.updatedAt,updated_by:c.updatedBy})));
      if(error) throw error; return {acked:changes.map(c=>c.id)}; },
    async pull(since){ const {data}=await sb.from('changes').select('*').gt('updated_at',since); return data; }};
}
------------------------------------------------------------------------------ */

let adapter=LocalOnlyAdapter, lastSync=null;
export function setAdapter(a){adapter=a}
export function getAdapter(){return adapter}
// Returns {kind:'local'|'offline'|'synced'|'pending', label, queued}
export function status(queued){
  if(adapter.localOnly) return {kind:'local',label:'Local only',queued};
  if(!navigator.onLine) return {kind:'offline',label:`Offline · ${queued} change${queued==1?'':'s'} queued`,queued};
  if(queued) return {kind:'pending',label:`Syncing · ${queued} queued`,queued};
  return {kind:'synced',label:'Synced',queued};
}
export async function syncNow(outbox,clear){
  if(adapter.localOnly||!navigator.onLine) return;
  const {acked}=await adapter.push(outbox()); clear(acked); lastSync=new Date().toISOString();
}
