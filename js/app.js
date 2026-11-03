import * as S from './storage.js';
import * as Sync from './sync.js';
import * as M from './model.js';
import {buildReport, sharePdf, reportFileName} from './report.js';
import {parseCsv, applyImport} from './importer.js';

export const NAMES=['Matt Morris','Travis Lowery','Sean West','Tracy Butler','Landon Pierce','Cody Mayberry','Zach Rhodes'];
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const first=n=>(n||'').split(' ')[0];
const tfmt=iso=>new Date(iso).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
const dtfmt=iso=>new Date(iso).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const dfmt=d=>new Date(d+'T12:00').toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'});
const ui={layout:localStorage.getItem('wmpm.layout')==='grid'?'grid':'cards',mode:'all',reportArea:'all',reportKind:'Mid-PM',parts:true,log:true,sheet:null,draft:null};
const user=()=>S.getUser(), isOwner=()=>user()===M.OWNER;
const pad=n=>String(n).padStart(2,'0');
const localParts=iso=>{const d=new Date(iso);return [`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,`${pad(d.getHours())}:${pad(d.getMinutes())}`]};

// ---------- shared pieces ----------
function syncPill(){const s=Sync.status(S.outbox().length);return `<span class="pill ${s.kind==='synced'?'pill-green':''}" id="syncpill" data-kind="${s.kind}"><span class="dot"></span>${esc(s.label)}</span>`}
function header(back,title,sub){const u=user();return `<header class="topbar"><div class="row sb">${back?`<a class="btn ghost sq" href="${back}" aria-label="Back">‹</a>`:`<span class="brand"><img src="brand/logo-horizontal.svg" alt="West Mechanical PM Tracker" id="brandlogo"></span>`}<div class="row" style="gap:8px">${syncPill()}${!back&&isOwner()?`<a class="btn ghost sq gear" id="settingsbtn" href="#/settings" aria-label="Settings">⚙</a>`:''}<button class="chip" id="userchip" aria-label="Switch user"><span class="av">${esc(u[0])}</span>${esc(first(u))}</button></div></div>
 ${title?`<h1 class="mt-3">${esc(title)}</h1>`:''}${sub?`<div class="muted font-bold mt-1">${sub}</div>`:''}</header>`}
const bar=(p,g)=>`<div class="bar ${g?'g':''}"><i style="width:${p}%"></i></div>`;
const layoutSeg=()=>`<div class="seg mt-2" role="tablist" aria-label="Layout">${['cards','grid'].map(m=>`<button class="${ui.layout===m?'on':''}" data-layout="${m}" role="tab" aria-selected="${ui.layout===m}">${m==='cards'?'▤ Cards':'▦ Grid'}</button>`).join('')}</div>`;
// ---------- spreadsheet-style grid (optional; per-device) ----------
function cellSummary(u,f){if(!u)return '';const fmt=a=>a.map(x=>`${x.qty}× ${M.sizeName(x.sizeId)}`).join(' + ');
 if(f==='filters')return u.filters?.length?fmt(u.filters):'';if(f==='belts')return u.belts?.length?fmt(u.belts):'';return ''}
function gridHtml(v,areas,items,whole){const its=items.filter(i=>ui.mode==='all'||M.remaining(v,i));
 if(!its.length)return `<div class="card done mt-4 text-center"><h2 class="green">✓ Nothing left</h2></div>`;
 const cols=[];its.forEach(it=>{const tf=it.kind==='unit'?M.tfields(v,it):['done'];tf.forEach(f=>cols.includes(f)||cols.push(f))});
 const order=['filters','belts','ops',M.MERGED,'done'];cols.sort((a,b)=>(order.indexOf(a)+99)%99-(order.indexOf(b)+99)%99);
 const act=v.status==='active';const aid=whole?'':(areas[0]?.id||'');
 const head=`<tr><th class="gsticky gcorner">Unit</th>${cols.map(f=>{const n=M.checkAllPlan(v,its,f).plan.length;const d=M.fieldDef(f);
   return `<th>${act&&n?`<button class="gcolbtn" data-gcol="${f}" data-garea="${aid}" aria-label="Check all ${esc(d.label)}">${esc(d.short||d.label)}<small>✓ all (${n})</small></button>`:`<span class="gcolh">${esc(d.short||d.label)}</span>`}</th>`}).join('')}<th>Notes / Issue</th><th>Row</th></tr>`;
 const row=it=>{const r=v.records[it.id]||{},u=it.kind==='unit'?M.unit(it.unitId):null,ap=M.fields(v,it),tf=it.kind==='unit'?M.tfields(v,it):['done'],iss=M.itemIssue(v,it),ro=!act||M.itemGone(it),done=M.itemDone(v,it);
   const cells=cols.map(f=>{if(!tf.includes(f))return '<td class="gnone"></td>';const na=!ap.includes(f),on=!!r[f]?.v,sum=cellSummary(u,f);
     if(na&&!on)return `<td><span class="gcell na" aria-disabled="true">N/A</span></td>`;
     return `<td><button class="gcell ${on?'on':''}" data-item="${esc(it.id)}" data-field="${f}" ${ro?'disabled':''} aria-pressed="${on}" aria-label="${esc(M.itemName(it))} ${esc(M.fieldDef(f).label)}"><span class="gbox">${on?'✓':''}</span>${sum?`<span class="gsum">${esc(sum)}</span>`:''}${on?`<span class="gstamp">${r[f].editedAt?'✎ ':''}${esc(first(r[f].by))} ${tfmt(r[f].at)}</span>`:''}</button></td>`}).join('');
   const left=ap.filter(f=>!r[f]?.v).length;
   return `<tr class="grow ${iss?'gissue':done?'gdone':''}" data-grow="${esc(it.id)}"><th class="gsticky"><button class="gname" data-gunit="${esc(it.id)}">${esc(M.itemName(it))}${u?.asset?`<small>Asset ${esc(u.asset)}</small>`:''}${u?.sample?'<small>sample</small>':''}</button></th>${cells}
    <td><button class="gflag ${iss?'on':''}" data-issue="${esc(it.id)}" ${ro?'disabled':''} aria-pressed="${iss}" aria-label="Issue">⚑</button>${r.note?.v?`<button class="gnote" data-gunit="${esc(it.id)}" aria-label="Note">✎</button>`:''}</td>
    <td>${!ro&&!iss&&left>1?`<button class="gcheckrow" data-checkall="${esc(it.id)}" aria-label="Check all for ${esc(M.itemName(it))}">✓ all</button>`:''}</td></tr>`};
 const body=areas.map(a=>{const rs=its.filter(i=>M.itemArea(i)===a.id);if(!rs.length)return '';return (whole?`<tr class="gsec"><th class="gsticky" colspan="1">${esc(a.name)}</th><td colspan="${cols.length+2}"></td></tr>`:'')+rs.map(row).join('')}).join('');
 return `<div class="gridwrap" id="grid"><table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table></div><p class="muted text-xs mt-2">Tap a cell to tick/untick · tap a unit name for notes, issue &amp; editing times · column header ✓ all ticks that column (skips ISSUE units).</p>`}
const seg=()=>`<div class="seg mt-3" role="tablist">${['all','remaining'].map(m=>`<button class="${ui.mode===m?'on':''}" data-mode="${m}" role="tab" aria-selected="${ui.mode===m}">${m==='all'?'All':'Remaining'}</button>`).join('')}</div>`;
function specLine(v,it){if(it.kind!=='unit')return '';const u=M.unit(it.unitId);if(!u)return '';const tf=M.tfields(v,it),p=[];
  const fmt=a=>a.map(x=>`${x.qty} x ${M.sizeName(x.sizeId)}`).join(' + ');
  if(tf.includes('filters'))p.push(!u.filters?'Filters N/A':u.filters.length?'Filters: '+fmt(u.filters):'');
  if(tf.includes('belts'))p.push(!u.belts?'Belts N/A':u.belts.length?'Belts: '+fmt(u.belts):'');
  return p.filter(Boolean).length?`<div class="spec">${p.filter(Boolean).map(esc).join(' · ')}</div>`:''}
const lastRec=(v,it,r)=>M.fields(v,it).map(f=>r[f]).filter(Boolean).sort((a,b)=>a.at<b.at?1:-1)[0];
function itemCard(v,it){const done=M.itemDone(v,it),iss=M.itemIssue(v,it),r=v.records[it.id]||{},ro=v.status!=='active'||M.itemGone(it),ap=M.fields(v,it);
  const u=it.kind==='unit'?M.unit(it.unitId):null;const tf=M.tfields(v,it);
  // show also logged entries for fields now hidden (e.g. condenser toggled off) as read-only
  const extraLogged=it.kind==='unit'?Object.keys(r).filter(f=>!tf.includes(f)&&!['note','issue'].includes(f)&&r[f]?.v):[];
  const chk=[...tf,...extraLogged].map(f=>{const na=!ap.includes(f),hidden=extraLogged.includes(f),on=!!r[f]?.v,d=M.fieldDef(f);
    return `<div class="cell"><button class="chk ${on?'on':''} ${na&&!hidden?'na':''}" data-item="${esc(it.id)}" data-field="${f}" ${na||ro?'disabled':''} aria-pressed="${on}"><span class="box">${na&&!on?'–':'✓'}</span><span class="lbl">${esc(d.short||d.label)}${na&&!on?' N/A':''}${hidden?' (off)':''}</span></button>${on?`<button class="tstamp" data-edit="${esc(it.id)}|${f}" aria-label="Edit time">${r[f].editedAt?'✎ ':''}${esc(first(r[f].by))}, ${tfmt(r[f].at)}</button>`:''}</div>`}).join('');
  const lr=done&&lastRec(v,it,r);
  return `<article class="card item ${iss?'issue':done?'done':''}" data-id="${esc(it.id)}">
   <div class="row sb" style="align-items:flex-start;gap:10px"><div style="min-width:0"><h2>${esc(M.itemName(it))}</h2>${it.kind==='task'?`<div class="tag">${esc(M.tmpl(v.templateId).label)} item</div>`:''}${u?.sample?`<div class="tag">sample unit</div>`:''}${u?.asset?`<div class="tag" data-asset>Asset ${esc(u.asset)}</div>`:''}${u?.cadence?`<div class="tag" data-cadence>${esc(u.cadence)}</div>`:''}${u?.notes?`<div class="muted text-sm" data-unotes>${esc(u.notes)}</div>`:''}${(u?.flags||[]).map(f=>`<div class="tag warn">⚠ ${esc(f)}</div>`).join('')}</div>
   <button class="flag ${iss?'on':''}" data-issue="${esc(it.id)}" ${ro?'disabled':''} aria-pressed="${iss}">⚑ ISSUE</button></div>
   ${specLine(v,it)}<div class="chks">${chk}</div>${!ro&&!done&&!iss&&ap.length>1&&ap.some(f=>!r[f]?.v)?`<button class="btn ghost sm checkall" data-checkall="${esc(it.id)}">✓ Check all (${ap.filter(f=>!r[f]?.v).length})</button>`:''}
   <textarea class="note" rows="2" placeholder="Add note…" data-note="${esc(it.id)}" ${ro?'disabled':''}>${esc(r.note?.v||'')}</textarea>
   <div class="row" style="gap:6px;flex-wrap:wrap">${r.note?.v?`<span class="stamp muted2">✎ note ${esc(first(r.note.by))}, ${tfmt(r.note.at)}</span>`:''}${iss?`<span class="stamp red">⚑ ${esc(first(r.issue.by))}, ${tfmt(r.issue.at)}</span>`:''}${lr&&!iss?`<span class="stamp">✓ Done by ${esc(first(lr.by))}, ${tfmt(lr.at)}</span>`:''}</div></article>`}

// ---------- screens ----------
function login(){const last=user();return `<main class="wrap login"><div class="splash-logo big-logo"><img src="brand/logo-horizontal.svg" alt="West Mechanical" id="loginlogo"></div>
 <h1 class="text-center mt-4">West Mechanical PM Tracker</h1><p class="muted text-center mt-2 font-bold">Who's on this device? Tap your name.</p>
 <div class="names mt-6">${NAMES.map(n=>`<button class="btn ghost name ${n===last?'sel':''}" data-name="${esc(n)}"><span class="av">${n[0]}</span>${esc(n)}</button>`).join('')}</div>
 <p class="muted text-center text-sm mt-6">No passwords. Every tap is stamped with your name &amp; time — it's your receipt.</p></main>`}
function home(){return header(null,null)+`<main class="wrap"><div class="muted font-bold mt-2">${new Date().toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'}).toUpperCase()}</div><h1>Locations</h1>
 <div class="tiles">${M.locations().map(l=>{const v=M.currentVisit(l.id),s=v?M.stats(v,M.visibleItems(v)):{pct:0,done:0,total:0,issues:0},dn=s.total&&s.done===s.total;
  return `<a class="card tile ${dn?'done':''}" href="#/l/${l.id}" data-loc="${l.id}"><div class="row sb"><h2>${esc(l.name)}</h2>${s.issues?`<span class="badge">⚑ ${s.issues}</span>`:dn?'<span class="green font-black">✓ DONE</span>':''}</div>
   <div class="muted text-sm font-bold">${esc(l.sub||'')}${l.placeholder?' · <span class="amber">sample units</span>':''}</div>${bar(s.pct,dn)}
   <div class="row sb muted text-sm font-bold mt-2"><span>${v?esc(v.label)+' · ':''}${s.done}/${s.total} items · ${s.pct}%</span><span class="${s.issues?'red':''}">${s.issues} issue${s.issues==1?'':'s'}</span></div></a>`}).join('')}</div>
 <a class="btn ghost mt-6" href="#/import">⇪ Import units (CSV)</a></main>`}
function areasForVisit(v){const all=M.areasOf(v.locationId,true);return all.filter(a=>v.status==='active'?!a.archived:v.items.some(i=>M.itemArea(i)===a.id))}
// schedule visit with nothing tagged: never a dead end -> tag units here, or start a regular all-areas visit
function emptySched(l,v){const gs=Object.keys(v.groupCodes||{}).map(id=>M.group(l.id,id)).filter(Boolean);const reg=M.templatesFor(l).filter(t=>t.id!=='schedule');
 return `<div class="card mt-4 empty" id="emptysched"><h2>No units tagged to ${gs.length==1?esc(gs[0].name):'these equipment groups'} yet</h2>
  <p class="muted mt-2 font-bold">Pick which units belong to the group and they'll show up here to check off.</p>
  <div class="mt-3" style="display:grid;gap:8px">${gs.map(g=>`<button class="btn primary" data-tagpick="${g.id}">🏷 Tag units to ${esc(g.name)}</button>`).join('')}
  ${reg.map(t=>`<button class="btn ghost" data-startreg="${t.id}">▶ Start ${esc(t.label)} instead (all areas)</button>`).join('')}</div></div>`}
function locView(l){const v=M.currentVisit(l.id);if(!v)return header('#/',l.name)+`<main class="wrap"><a class="btn primary" href="#/l/${l.id}/visits">Start a visit</a></main>`;
 const items=M.visibleItems(v),s=M.stats(v,items),t=M.tmpl(v.templateId);let body='';
 if(!items.length)body=v.templateId==='schedule'?emptySched(l,v):`<div class="card mt-4 empty"><h2>No units in this visit</h2><p class="muted mt-2 font-bold">${esc(t.emptyText||'No units yet.')}</p></div>`;
 else if(ui.layout==='grid')body=gridHtml(v,areasForVisit(v),items,true);
 else if(ui.mode==='all')body=areasForVisit(v).map(a=>{const its=M.visibleItems(v,a.id);if(!its.length)return '';const x=M.stats(v,its),dn=x.total&&x.done===x.total;
  return `<a class="card area ${dn?'done':''}" href="#/l/${l.id}/a/${a.id}" data-area="${a.id}"><div class="row sb"><h2>${esc(a.name)}${a.archived?' (removed)':''}</h2>${x.issues?`<span class="badge">⚑ ${x.issues}</span>`:dn?'<span class="green font-black">✓ DONE</span>':''}</div>${bar(x.pct,dn)}
   <div class="row sb muted text-sm font-bold mt-2"><span>${x.done}/${x.total} items</span><span>${x.last?esc(first(x.last.by))+', '+tfmt(x.last.at):''}</span></div></a>`}).join('');
 else body=remainingList(v,areasForVisit(v),items);
 return header('#/',l.name,`${esc(v.label)} · ${dfmt(v.date)}${v.status!=='active'?' · <span class="green">COMPLETED (history)</span>':''}`)+`<main class="wrap has-bottom">
  <div class="row mt-3" style="gap:8px"><a class="btn ghost sm" href="#/l/${l.id}/visits">📋 Visits (${M.st().visits.filter(x=>x.locationId===l.id).length})</a><a class="btn ghost sm" href="#/l/${l.id}/history">🕘 History log</a>${l.schedule?`<a class="btn ghost sm" id="schedbtn" href="#/l/${l.id}/schedule">🗓 Schedule</a>`:''}</div>${(()=>{const mv=M.monthVisit(l.id);return mv&&mv.id!==v.id&&mv.status==='active'&&mv.items.length?`<button class="card mt-3" id="monthbanner" data-openv="${mv.id}" style="width:100%;text-align:left;border-color:#e8a33d"><div class="amber font-black">🗓 ${esc(mv.label)} is ready (${mv.items.length} items)</div><div class="muted font-bold text-sm">Tap to open it · you're on ${esc(v.label)}</div></button>`:''})()}${v.outOfSeason?'<span class="tag" id="oostag">Out of season</span>':''}${v.kind==='month'?`<span class="tag" id="monthtag">Monthly visit · stays open all month</span>`:''}${l.schedule&&M.overdue(l.id).length?`<a class="card issue mt-3" style="display:block" id="overduebanner" href="#/l/${l.id}/schedule"><b class="red">⚠ Overdue from ${M.overdue(l.id).map(o=>esc(o.visit.label)).join(', ')}</b><div class="muted text-sm">${M.overdue(l.id).reduce((n,o)=>n+o.open.length,0)} item(s) still open · tap for Schedule</div></a>`:''}
  <div class="card prog"><div class="row sb"><div><div class="muted font-bold text-sm">OVERALL PROGRESS</div><div class="big">${s.done}<span class="muted text-xl">/${s.total} items</span></div></div><div class="text-right"><div class="big amber">${s.pct}%</div><div class="red font-bold">${s.issues} issue${s.issues==1?'':'s'}</div></div></div>${bar(s.pct)}</div>
  ${seg()}${layoutSeg()}<div id="list">${body}</div></main>
  <nav class="bottom"><div class="row" style="gap:10px"><a class="btn primary" href="#/l/${l.id}/report">📄 Issue Report</a><a class="btn ghost" style="width:40%" href="#/l/${l.id}/parts">🧰 Parts</a></div></nav>`}
function remainingList(v,areas,items){const rem=items.filter(i=>M.remaining(v,i));
 if(!rem.length)return `<div class="card done mt-4 text-center"><h2 class="green">✓ Nothing left</h2><p class="muted">All items checked, no open issues.</p></div>`;
 return `<div class="muted font-bold mt-3" id="remcount">${rem.length} remaining</div>`+areas.map(a=>{const r=rem.filter(i=>M.itemArea(i)===a.id).sort((x,y)=>M.itemIssue(v,y)-M.itemIssue(v,x));return r.length?`<h3 class="grp">${esc(a.name)} <span class="muted">(${r.length})</span></h3>`+r.map(i=>itemCard(v,i)).join(''):''}).join('')}
function areaView(l,a){const v=M.currentVisit(l.id),its=M.visibleItems(v,a.id),x=M.stats(v,its);
 const shown=ui.layout==='grid'?gridHtml(v,[a],its,false):ui.mode==='all'?its.map(i=>itemCard(v,i)).join(''):remainingList(v,[a],its);
 const cp=v.status==='active'?M.checkAllPlan(v,its):{plan:[]};
 return header('#/l/'+l.id,a.name,`<div class="row sb"><span>${x.done}/${x.total} items complete</span><span class="red">${x.issues} issue${x.issues==1?'':'s'}</span></div>`)+`<main class="wrap has-bottom">${bar(x.pct)}${cp.plan.length?`<button class="btn ghost mt-3" id="checkarea" data-checkarea="${a.id}">✓ Check all in ${esc(a.name)} (${cp.plan.length})</button>`:''}${seg()}${layoutSeg()}<div id="list">${shown}</div></main>
 <nav class="bottom stats"><span class="green">✓ ${x.done} done</span><span class="amber">● ${x.prog} in prog</span><span class="red">⚑ ${x.issues} issues</span><span class="muted">○ ${x.left} left</span></nav>`}
function visitsView(l){const vs=M.st().visits.filter(x=>x.locationId===l.id).slice().reverse(),cur=M.currentVisit(l.id);
 return header('#/l/'+l.id,'Visits',esc(l.name))+`<main class="wrap"><div class="card"><h2>Start new visit from template</h2>
 <label class="lab">Template<select id="tpl" class="inp">${M.templatesFor(l).map(t=>`<option value="${t.id}">${esc(t.label)}${t.extra.length?` (+${t.extra.length} items/area)`:''}${t.noUnits?' (empty for now)':''}</option>`).join('')}</select></label>
 <label class="lab">Label<input id="vlabel" class="inp" placeholder="e.g. Fall Heating Prep 2026"></label>
 <label class="lab">Date<input id="vdate" type="date" class="inp" value="${M.today()}"></label>
 <button class="btn primary mt-3" id="startvisit">＋ Start visit</button>${l.schedule?`<a class="btn ghost mt-2" href="#/l/${l.id}/schedule">🗓 Start by equipment group (any month)</a>`:''}</div>
 <h3 class="grp">All visits</h3>${vs.map(x=>{const s=M.stats(x,M.visibleItems(x));return `<div class="card ${x.id===cur?.id?'cur':''}"><div class="row sb"><div><h2>${esc(x.label)}</h2><div class="muted text-sm font-bold">${dfmt(x.date)} · ${s.done}/${s.total} · ${s.issues} issues · ${x.status==='active'?'<span class="amber">active</span>':'<span class="green">completed</span>'}</div></div>${x.id===cur?.id?'<span class="pill">Current</span>':''}</div>
  <div class="row mt-3" style="gap:8px">${x.id!==cur?.id?`<button class="btn ghost sm" data-open="${x.id}">Open</button>`:''}${x.status==='active'?`<button class="btn ghost sm" data-complete="${x.id}">✓ Mark complete</button>`:`<button class="btn ghost sm" data-reopen="${x.id}">Reopen</button>`}</div></div>`}).join('')}</main>`}
function historyView(l){const rows=[];for(const v of M.st().visits.filter(x=>x.locationId===l.id))for(const it of v.items)for(const [f,r] of Object.entries(v.records[it.id]||{}))rows.push({v,it,f,r});
 rows.sort((a,b)=>a.r.at<b.r.at?1:-1);
 return header('#/l/'+l.id,'History log',esc(l.name)+' · names shown are current names')+`<main class="wrap"><div id="hist">${rows.map(({v,it,f,r})=>`<div class="hrow" data-h="${esc(it.id)}"><div class="row sb"><b>${esc(M.itemName(it))}</b><span class="muted text-sm">${esc(v.label)}</span></div>
  <div class="text-sm">${f==='note'?'Note: '+esc(r.v):f==='issue'?(r.v?'⚑ Issue flagged':'Issue cleared'):(r.v?'✓ ':'○ unchecked ')+esc(M.fieldDef(f).label)} · ${esc(r.by)} · ${dtfmt(r.at)}${r.editedAt?` <span class="amber">✎ time edited (logged ${dtfmt(r.originalLoggedAt)})</span>`:''}</div></div>`).join('')||'<p class="muted mt-4">No entries yet.</p>'}</div></main>`}
function partsView(l){const v=M.currentVisit(l.id),p=M.partsList(v,M.visibleItems(v));
 const tbl=(rows,left,unit)=>rows.length?`<table class="parts"><tr><th>Size</th><th>Total</th><th>Still to change</th></tr>${rows.map(([k,n])=>`<tr><td>${esc(k)}</td><td>${n}</td><td class="${left[k]?'amber':'green'}">${left[k]||'✓ 0'}</td></tr>`).join('')}<tr class="tot"><td>Total ${unit}</td><td>${rows.reduce((s,r)=>s+r[1],0)}</td><td>${Object.values(left).reduce((s,n)=>s+n,0)}</td></tr></table>`:'<p class="muted mt-2">No sizes listed for these units yet.</p>';
 return header('#/l/'+l.id,'Parts list',`${esc(l.name)} · ${esc(v.label)}`)+`<main class="wrap"><div class="card"><h2>Filters by size</h2>${tbl(p.filters,p.filtersLeft,'filters')}</div><div class="card"><h2>Belts by size</h2>${tbl(p.belts,p.beltsLeft,'belts')}</div><p class="muted text-sm mt-3">Totals = qty × size summed across all units in this visit. "Still to change" counts units whose Filters/Belts box is not checked yet.</p></main>`}
function reportView(l){const v=M.currentVisit(l.id),ar=ui.reportArea==='all'?null:M.area(ui.reportArea);
 return header('#/l/'+l.id,'Issue Report',esc(l.name))+`<main class="wrap has-bottom"><div class="seg">${['Mid-PM','End-of-PM'].map(k=>`<button class="${ui.reportKind===k?'on':''}" data-kind="${k}">${k}</button>`).join('')}</div>
 <label class="lab mt-3">Areas<select id="rarea" class="inp"><option value="all">All areas (whole location)</option>${areasForVisit(v).map(a=>`<option value="${a.id}" ${ui.reportArea===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>
 <label class="toggle mt-2"><input type="checkbox" id="rparts" ${ui.parts?'checked':''}> Include parts list (filters &amp; belts by size)</label>
 <label class="toggle"><input type="checkbox" id="rlog" ${ui.log?'checked':''}> Include check log (who/when for every check)</label>
 <div id="preview">${reportPreview(l,v,ar)}</div></main>
 <nav class="bottom"><div class="text-center muted text-sm font-bold" id="fname">📁 ${esc(reportFileName(l,ar,v))}</div><button class="btn primary mt-2" id="mkpdf">⬇ Save PDF to phone</button><div class="text-center muted text-xs mt-1">Generated on-device · works offline · no email</div></nav>`}
function reportPreview(l,v,ar){const areas=ar?[ar]:areasForVisit(v);const its=M.visibleItems(v).filter(i=>areas.some(a=>a.id===M.itemArea(i)));const s=M.stats(v,its);
 return `<div class="paper"><div class="ptop">${esc(l.name.toUpperCase())} · ${esc((l.sub||'').toUpperCase())}</div><div class="ptitle">${ui.reportKind} Report – ${esc(ar?ar.name:'All areas')} – ${dfmt(v.date)}</div>
 <div class="psub">${esc(v.label)} · ${s.done}/${s.total} items · ${s.issues} issues · tech ${esc(user())}</div>
 ${areas.map(a=>{const iss=v.items.filter(i=>M.itemArea(i)===a.id&&M.itemIssue(v,i));return iss.length?`<h3>${esc(a.name.toUpperCase())} (${iss.length})</h3>`+iss.map(i=>{const r=v.records[i.id];return `<div class="it"><b>${esc(M.itemName(i))}</b> — ${esc(r.note?.v||'(no note)')}<small>⚑ ${esc(r.issue.by)} · ${tfmt(r.issue.at)}</small></div>`}).join(''):''}).join('')||'<p class="pnone">No flagged issues.</p>'}</div>`}
function importView(){return header('#/','Import units',`CSV columns: <code>location,area,unit</code>`)+`<main class="wrap"><div class="card">
 <label class="lab">Upload CSV<input type="file" id="csvfile" accept=".csv,text/csv" class="inp"></label>
 <label class="lab">…or paste CSV<textarea id="csvtext" class="inp" rows="7" placeholder="location,area,unit&#10;Hills Pet Foods,Boiler Room,Boiler B-3"></textarea></label>
 <div class="seg mt-3"><button class="${ui.imp!=='replace'?'on':''}" data-imp="add">Add units</button><button class="${ui.imp==='replace'?'on':''}" data-imp="replace">Replace units</button></div>
 <p class="muted text-sm mt-2">Replace = units of each location named in the CSV that are not in the CSV are archived (soft-deleted; history kept). New units are added to the open visit.</p>
 <button class="btn primary mt-3" id="doimport">Import</button><div id="impresult" class="mt-3 font-bold"></div></div></main>`}

// ---------- schedule (tap any group in ANY month; greyed = nothing due this month) ----------
function monthGrid(l,g,cm){return `<div class="mgrid">${M.MONTHS.map((n,i)=>{const c=M.codesIn(g,i+1);return `<div class="mcell ${i+1===cm?'cur':''} ${c.length?'has':''}" data-m="${i+1}"><b>${n}</b><span>${c.map(esc).join(' ')||'·'}</span></div>`}).join('')}</div>`}
function scheduleView(l){const sc=l.schedule,cm=M.curMonth(),od=M.overdue(l.id),mv=M.monthVisit(l.id);
 return header('#/l/'+l.id,'Schedule',`${esc(l.name)} · ${M.MONTHS[cm-1]} highlighted`)+`<main class="wrap">
 <p class="muted text-sm mt-2">Source: ${esc(sc.source)}${sc.sourceNote?` — <span class="amber">${esc(sc.sourceNote)}</span>`:''}</p>
 ${mv?`<a class="btn primary mt-2" href="#/l/${l.id}">▶ Resume ${esc(mv.label)} (${M.stats(mv,M.visibleItems(mv)).pct}%)</a>`:''}
 ${od.map(o=>`<div class="card issue" data-overdue="${o.visit.id}"><b class="red">⚠ Overdue: ${esc(o.visit.label)}</b><div class="text-sm">${o.open.length} item(s) open · ${o.groups.map(g=>esc(M.group(l.id,g)?.name||'')).join(', ')}</div><button class="btn ghost sm mt-2" data-openv="${o.visit.id}">Open overdue visit</button></div>`).join('')}
 <div id="sched">${M.groupsOf(l.id).map(g=>{const c=M.codesIn(g,cm),n=M.groupUnits(l.id,g.id).length;
  return `<button class="card sgroup ${c.length?'due':'notdue'}" data-group="${g.id}"><div class="row sb"><h2>${esc(g.name)}</h2><span class="muted text-sm">${n} unit${n==1?'':'s'}</span></div>
  ${c.length?`<div class="codes">${c.map(x=>`<span class="code">${esc(x)} · ${esc(M.codeLabel(l.id,x))}</span>`).join('')}</div>`:`<div class="nothing">Nothing due this month</div>`}
  ${M.groupOverdue(l.id,g.id).length?'<div class="red font-bold text-sm">⚠ Overdue items</div>':''}
  ${monthGrid(l,g,cm)}${g.notes.map(x=>`<div class="muted text-sm">Note: ${esc(x)}</div>`).join('')}</button>`}).join('')}</div>
 <details class="mt-4"><summary class="muted font-bold">Code legend</summary>${sc.legend.map(x=>`<div class="text-sm"><b>${esc(x.code)}</b> = ${esc(x.label)}</div>`).join('')}</details></main>`}
function settingsGroups(l){const gs=(l.schedule?.groups||[]).slice().sort((a,b)=>(a.order??0)-(b.order??0));return header('#/settings/l/'+l.id,'Equipment groups',esc(l.name)+' · schedule')+`<main class="wrap"><div class="card">
 <div class="row" style="gap:8px"><input id="newgroup" class="inp" style="margin:0" placeholder="New group name"><button class="btn primary mini2" data-addgroup="${l.id}">＋ Add</button></div>
 ${gs.map(g=>`<div class="srow" data-grow="${g.id}"><a class="sname" href="#/settings/l/${l.id}/g/${g.id}">${esc(g.name)}${g.archived?' (archived)':''}<small class="muted"> · ${M.groupUnits(l.id,g.id).length} units</small></a>${g.archived?`<button class="btn primary mini2" data-garch="${g.id}|0">Restore</button>`:`<button class="btn ghost mini2" data-garch="${g.id}|1">Archive</button>`}</div>`).join('')||'<p class="muted">No groups yet.</p>'}</div></main>`}
function settingsGroup(l,g){const cm=M.curMonth();return header('#/settings/l/'+l.id+'/groups',g.name,'Group editor · codes per month')+`<main class="wrap"><div class="card">
 <label class="lab">Group name<input class="inp" id="gname" value="${esc(g.name)}"></label><label class="lab">Notes (one per line)<textarea class="inp" id="gnotes" rows="2">${esc(g.notes.join('\n'))}</textarea></label>
 <button class="btn primary mt-3" data-savegroup="${g.id}">Save</button>${g.updatedBy?`<p class="stampline">Last edit: ${esc(g.updatedBy)}, ${dtfmt(g.updatedAt)}</p>`:''}</div>
 <h3 class="grp">Month grid</h3><div class="card"><p class="muted text-sm">Codes separated by commas, e.g. PF, BC. Blank = nothing due.</p>${M.MONTHS.map((n,i)=>`<div class="row" style="gap:8px"><b style="width:44px" class="${i+1===cm?'amber':''}">${n}</b><input class="inp" style="margin:4px 0" data-gmonth="${g.id}|${i+1}" value="${esc(M.codesIn(g,i+1).join(', '))}"></div>`).join('')}<div id="gerr" class="red font-bold"></div></div>
 <details class="mt-3"><summary class="muted font-bold">Code legend</summary>${l.schedule.legend.map(x=>`<div class="text-sm"><b>${esc(x.code)}</b> = ${esc(x.label)}</div>`).join('')}</details></main>`}

// ---------- owner settings ----------
const COLL_LABEL={locations:'location',areas:'area',units:'unit',sizes:'size'};
function sRow(coll,e,href,extra){return `<div class="srow" data-row="${e.id}"><a class="sname" href="${href||'#'}">${esc(e.name)}<small class="muted">${extra||''}</small></a>
 <button class="btn ghost mini" data-up="${coll}|${e.id}" aria-label="Move up">▲</button><button class="btn ghost mini" data-down="${coll}|${e.id}" aria-label="Move down">▼</button></div>`}
function settingsHome(){return header('#/','Settings','Owner only · every edit is stamped with who/when')+`<main class="wrap">
 <h3 class="grp">Locations</h3><div class="card">${M.locations().map(l=>sRow('locations',l,'#/settings/l/'+l.id,` · ${M.areasOf(l.id).length} areas`)).join('')}
 <div class="row mt-3" style="gap:8px"><input id="newloc" class="inp" style="margin:0" placeholder="New location name"><button class="btn primary mini2" id="addloc">＋ Add</button></div></div>
 <h3 class="grp">Standard sizes</h3><a class="btn ghost mt-2" href="#/settings/sizes/filter">Filter sizes (${M.sizes('filter').length})</a><a class="btn ghost mt-2" href="#/settings/sizes/belt">Belt sizes (${M.sizes('belt').length})</a>
 <h3 class="grp">Data</h3><a class="btn ghost mt-2" href="#/settings/archived">🗄 Archived items (${['locations','areas','units','sizes'].reduce((n,c)=>n+M.st()[c].filter(x=>x.archived).length,0)})</a>
 <button class="btn ghost mt-2" id="exportbk">⬆ Export full backup (JSON)</button><label class="btn ghost mt-2">⬇ Restore from backup<input type="file" id="importbk" accept=".json,application/json" hidden></label>
 <p class="muted text-sm mt-3">Settings are only shown when “Zach Rhodes” is picked on this device. This is a convenience gate, not security.</p><div id="bkresult" class="font-bold mt-2"></div></main>`}
function settingsLoc(l){const f=l.features||{};return header('#/settings',l.name,'Location editor')+`<main class="wrap">
 <div class="card"><label class="lab">Name<input class="inp" id="ename" value="${esc(l.name)}"></label><label class="lab">Subtitle<input class="inp" id="esub" value="${esc(l.sub||'')}"></label><button class="btn primary mt-3" data-saveent="locations|${l.id}">Save</button>
 ${hist(l)}</div>
 <div class="card"><label class="toggle big"><input type="checkbox" id="featcond" data-feat="${l.id}|condenserCoil" ${f.condenserCoil?'checked':''}> Show Condenser or Coil Cleaning checkbox</label>
 <p class="muted text-sm">One field for coil clean and condenser coil cleaning (schedule code CC). On at Hills; opt-in elsewhere. Turning it off hides it; already-logged entries stay in history &amp; PDFs.</p>${f.condenserCoilUpdatedBy?`<p class="stampline">Set ${f.condenserCoil?'ON':'OFF'} by ${esc(f.condenserCoilUpdatedBy)}, ${dtfmt(f.condenserCoilUpdatedAt)}</p>`:''}</div>
 <a class="btn ghost mt-2" id="grpmgr" href="#/settings/l/${l.id}/groups">🗓 Equipment groups &amp; schedule (${M.groupsOf(l.id).length})</a>
 <h3 class="grp">Areas</h3><div class="card">${M.areasOf(l.id).map(a=>sRow('areas',a,'#/settings/a/'+a.id,` · ${M.unitsOf(a.id).length} units`)).join('')||'<p class="muted">No areas.</p>'}
 <div class="row mt-3" style="gap:8px"><input id="newarea" class="inp" style="margin:0" placeholder="New area name"><button class="btn primary mini2" data-addarea="${l.id}">＋ Add</button></div></div>
 <button class="btn danger mt-6" data-del="locations|${l.id}">🗑 Delete location</button></main>`}
const hist=e=>(e.nameHistory?.length?`<details class="mt-3"><summary class="muted font-bold">Old names (${e.nameHistory.length})</summary>${e.nameHistory.map(h=>`<div class="text-sm muted">${esc(h.name)} — renamed by ${esc(h.by)}, ${dtfmt(h.at)}</div>`).join('')}</details>`:'')+(e.updatedBy?`<p class="stampline">Last edit: ${esc(e.updatedBy)}, ${dtfmt(e.updatedAt)}</p>`:'');
function settingsArea(a){const l=M.loc(a.locationId);return header('#/settings/l/'+l.id,a.name,esc(l.name)+' · Area editor')+`<main class="wrap">
 <div class="card"><label class="lab">Area name<input class="inp" id="ename" value="${esc(a.name)}"></label><button class="btn primary mt-3" data-saveent="areas|${a.id}">Save</button>${hist(a)}</div>
 <h3 class="grp">Units (line items)</h3><div class="card">${M.unitsOf(a.id).map(u=>sRow('units',u,'#/settings/u/'+u.id)).join('')||'<p class="muted">No units.</p>'}
 <a class="btn primary mt-3" href="#/settings/u/new?area=${a.id}">＋ Add unit</a></div>
 <button class="btn danger mt-6" data-del="areas|${a.id}">🗑 Delete area</button></main>`}
function sizeOpts(kind,sel){return M.sizes(kind).map(s=>`<option value="${s.id}" ${s.id===sel?'selected':''}>${esc(s.name)}</option>`).join('')+`<option value="__new">＋ Add new size…</option>`}
function settingsUnit(id,areaId){let d=ui.draft;
 if(!d||d._for!==id+'|'+(areaId||'')){const u=id!=='new'&&M.unit(id);d=ui.draft=u?{_for:id+'|',id:u.id,name:u.name,areaId:u.areaId,filters:structuredClone(u.filters),belts:structuredClone(u.belts),checks:{...u.checks},equipmentGroupId:u.equipmentGroupId||'',asset:u.asset||'',cadence:u.cadence||'',notes:u.notes||''}:{_for:id+'|'+areaId,equipmentGroupId:'',name:'',areaId,filters:[],belts:[],checks:Object.fromEntries(M.st().fieldDefs.map(f=>[f.id,true])),addToVisit:true}}
 const a=M.area(d.areaId),l=M.loc(a.locationId),u=d.id&&M.unit(d.id);
 const rows=(k,kind)=>d[k]===null?`<p class="muted">${k==='belts'?'No belts (N/A)':'No filters (N/A)'}</p>`:d[k].map((x,i)=>`<div class="row qrow" style="gap:8px"><input type="number" inputmode="numeric" min="1" class="inp qty" data-q="${k}|${i}" value="${x.qty}"><select class="inp" data-sz="${k}|${i}|${kind}">${sizeOpts(kind,x.sizeId)}</select><button class="btn ghost mini" data-rmrow="${k}|${i}" aria-label="Remove">✕</button></div>`).join('');
 return `<div class="sheet-back"></div><section class="sheet" role="dialog" aria-label="Unit editor"><div class="grab"></div>
 <div class="row sb"><h2>${u?'Edit unit':'New unit'}</h2><a class="btn ghost mini2" href="#/settings/a/${a.id}">Close</a></div>
 <label class="lab">Unit name<input class="inp" id="uname" value="${esc(d.name)}" placeholder="e.g. RTU-8"></label>
 <div class="row" style="gap:8px"><label class="lab" style="flex:1">Asset #<input class="inp" id="uasset" value="${esc(d.asset||'')}"></label><label class="lab" style="flex:1">Cadence<select class="inp" id="ucad"><option value="">—</option>${['quarterly','annual'].map(c=>`<option ${d.cadence===c?'selected':''}>${c}</option>`).join('')}</select></label></div>
 <label class="lab">Notes<input class="inp" id="unotes" value="${esc(d.notes||'')}"></label>
 <label class="lab">Area<select class="inp" id="uarea">${M.areasOf(l.id).map(x=>`<option value="${x.id}" ${x.id===d.areaId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
 ${l.schedule?`<label class="lab">Equipment group (schedule)<select class="inp" id="ugroup"><option value="">— none (untagged) —</option>${M.groupsOf(l.id).map(g=>`<option value="${g.id}" ${g.id===d.equipmentGroupId?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>`:''}
 <div class="lab">Filters</div>${rows('filters','filter')}<div class="row" style="gap:8px"><button class="btn ghost sm" data-addrow="filters">＋ Filter line</button><button class="btn ghost sm" data-na="filters">${d.filters===null?'Has filters':'N/A'}</button></div>
 <div class="lab">Belts</div>${rows('belts','belt')}<div class="row" style="gap:8px"><button class="btn ghost sm" data-addrow="belts">＋ Belt line</button><button class="btn ghost sm" data-na="belts">${d.belts===null?'Has belts':'No belts / N/A'}</button></div>
 <div class="lab">Checks that apply</div><div class="checkgrid">${M.st().fieldDefs.map(f=>`<label class="toggle"><input type="checkbox" data-chk="${f.id}" ${d.checks[f.id]!==false?'checked':''}> ${esc(f.label)}${f.feature&&!l.features?.[f.feature]?' <small class="muted">(off at this location)</small>':''}</label>`).join('')}</div>
 ${!u?`<label class="toggle"><input type="checkbox" id="uaddvisit" ${d.addToVisit?'checked':''}> Also add to the current open visit</label>`:''}
 <button class="btn primary mt-3" id="saveunit">Save unit</button>${u?`<button class="btn danger mt-3" data-del="units|${u.id}">🗑 Delete unit</button>${hist(u)}`:''}</section>`}
function settingsSizes(kind){return header('#/settings',kind==='filter'?'Filter sizes':'Belt sizes','Rename updates every unit & parts list')+`<main class="wrap"><div class="card">
 <div class="row" style="gap:8px"><input id="newsize" class="inp" style="margin:0" placeholder="${kind==='filter'?'e.g. 20X20X2':'e.g. A49'}"><button class="btn primary mini2" data-addsize="${kind}">＋ Add</button></div>
 ${M.sizes(kind).map(s=>`<div class="row srow" style="gap:8px" data-row="${s.id}"><input class="inp" style="margin:0" data-szname="${s.id}" value="${esc(s.name)}"><small class="muted nowrap">${M.logCount('sizes',s.id)} units</small><button class="btn ghost mini" data-del="sizes|${s.id}" aria-label="Delete size">🗑</button></div>`).join('')}</div></main>`}
function settingsArchived(){const list=['locations','areas','units','sizes'].flatMap(c=>M.st()[c].filter(x=>x.archived).map(e=>({c,e})));
 return header('#/settings','Archived items','Soft-deleted · history still shows them as “(removed)”')+`<main class="wrap">${list.map(({c,e})=>`<div class="card srow" data-arch="${e.id}"><div style="min-width:0;flex:1"><b>${esc(e.name)}</b> <span class="tag">${COLL_LABEL[c]}</span><div class="muted text-sm">${c==='units'?esc(M.area(e.areaId)?.name||''):c==='areas'?esc(M.loc(e.locationId)?.name||''):''} · removed by ${esc(e.deletedBy)}, ${dtfmt(e.deletedAt)}</div></div><button class="btn primary mini2" data-restore="${c}|${e.id}">Restore</button></div>`).join('')||'<p class="muted mt-4">Nothing archived.</p>'}</main>`}

// ---------- sheets (time edit, confirm, prompt) ----------
function sheetHtml(){const s=ui.sheet;if(!s)return '';
 if(s.type==='time'){const v=M.st().visits.find(x=>x.id===s.visit),r=v.records[s.item][s.field],[d,t]=localParts(r.at),it=v.items.find(i=>i.id===s.item);
  return `<div class="sheet-back" data-close></div><section class="sheet" role="dialog" aria-label="Edit time"><div class="grab"></div><h2>Edit time</h2>
  <p class="muted font-bold">${esc(M.itemName(it))} · ${esc(M.fieldDef(s.field).label)} · by ${esc(r.by)}</p>
  <div class="row" style="gap:8px"><label class="lab" style="flex:1">Date<input type="date" class="inp" id="tdate" value="${d}" max="${M.today()}"></label><label class="lab" style="flex:1">Time<input type="time" class="inp" id="ttime" value="${t}"></label></div>
  <div id="terr" class="red font-bold mt-2"></div>
  <div class="detail mt-3"><div>Logged (actual tap): <b>${dtfmt(r.originalLoggedAt||r.at)}</b></div>${r.editedAt?`<div>✎ Time edited by ${esc(r.editedBy)} at ${dtfmt(r.editedAt)}</div>`:''}${(r.history||[]).map(h=>`<div class="muted text-sm">${dtfmt(h.from)} → ${dtfmt(h.to)} (${esc(h.editedBy)})</div>`).join('')}</div>
  <div class="row mt-3" style="gap:10px"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="savetime">Save</button></div></section>`}
 if(s.type==='confirm')return `<div class="sheet-back" data-close></div><section class="sheet" role="alertdialog" aria-label="Confirm delete"><div class="grab"></div><h2>Delete ${esc(COLL_LABEL[s.coll])} “${esc(s.name)}”?</h2>
  <p class="mt-2 font-bold">${s.coll==='sizes'?`Used by <b class="amber">${s.count}</b> unit${s.count==1?'':'s'}.`:`<b class="amber">${s.count}</b> log entr${s.count==1?'y is':'ies are'} attached.`} Nothing is erased: it moves to Archived, past PM logs and reports still show it as “(removed)”, and you can Restore it.</p>
  ${s.coll==='locations'||s.coll==='areas'?`<p class="muted mt-2">Everything inside it (${s.coll==='locations'?'areas and units':'units'}) is archived too.</p>`:''}
  <div class="row mt-4" style="gap:10px"><button class="btn ghost" data-close>Keep it</button><button class="btn danger" id="confirmdel">Yes, delete</button></div></section>`;
 if(s.type==='group'){const l=M.loc(s.lid),g=M.group(s.lid,s.gid),due=M.codesIn(g,M.curMonth()),all=[...new Set(Object.values(g.months).flat())];const codes=[...new Set([...all,...s.codes])];
  return `<div class="sheet-back" data-close></div><section class="sheet" role="dialog" aria-label="Start group visit"><div class="grab"></div><h2>${esc(g.name)}</h2>
  <p class="muted font-bold">${due.length?'Due this month: '+due.join(', '):'Not scheduled this month — will be tagged “Out of season”.'}</p>
  <div class="lab">Codes to include</div><div class="checkgrid">${codes.map(c=>`<label class="toggle"><input type="checkbox" data-gcode="${c}" ${s.codes.includes(c)?'checked':''}> ${esc(c)} · ${esc(M.codeLabel(l.id,c))}</label>`).join('')}</div>
  <div class="row mt-3" style="gap:10px"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="startgroup">Start visit</button></div></section>`}
 if(s.type==='unit'){const v=M.st().visits.find(x=>x.id===s.visit),it=v.items.find(i=>i.id===s.item);if(!it)return '';
  return `<div class="sheet-back" data-close></div><section class="sheet unitsheet" role="dialog" aria-label="Unit detail"><div class="grab"></div><div class="row sb"><h2>Unit detail</h2><button class="btn ghost mini2" data-close>Close</button></div>${itemCard(v,it)}</section>`}
 if(s.type==='tagpick'){const l=M.loc(s.loc),g=M.group(l.id,s.group);
  return `<div class="sheet-back" data-close></div><section class="sheet" role="dialog" aria-label="Tag units"><div class="grab"></div><h2>Tag units to ${esc(g.name)}</h2>
  <p class="muted font-bold mt-1">Tick every unit in this group. Units already in another group are moved.</p><div id="tagpicklist" style="max-height:55vh;overflow:auto" class="mt-2">
  ${M.areasOf(l.id).map(a=>{const us=M.unitsOf(a.id);if(!us.length)return '';return `<div class="muted font-black text-sm mt-3">${esc(a.name)}</div>`+us.map(u=>{const o=u.equipmentGroupId&&u.equipmentGroupId!==g.id?M.group(l.id,u.equipmentGroupId):null;
   return `<label class="row" style="gap:10px;min-height:44px"><input type="checkbox" data-tagu="${u.id}" ${u.equipmentGroupId===g.id?'checked':''} style="width:24px;height:24px;flex:none"><span class="font-bold">${esc(u.name)}${o?` <small class="muted">(in ${esc(o.name)})</small>`:''}</span></label>`}).join('')}).join('')}</div>
  <div class="row mt-4" style="gap:10px"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="savetags">Save tags</button></div></section>`}
 if(s.type==='checkcol'){const v=M.st().visits.find(x=>x.id===s.visit),a=s.area?M.area(s.area):null,its=M.visibleItems(v,a?.id).filter(i=>ui.mode==='all'||M.remaining(v,i)),{plan,skipped}=M.checkAllPlan(v,its,s.field),d=M.fieldDef(s.field);
  return `<div class="sheet-back" data-close></div><section class="sheet" role="alertdialog" aria-label="Confirm check column"><div class="grab"></div><h2>Check ${esc(d.label)} on ${plan.length} unit${plan.length==1?'':'s'} in ${esc(a?a.name:M.loc(v.locationId).name)}?</h2>
  <p class="muted font-bold mt-2">Each is stamped ${esc(user())}, now. Already-checked cells keep their stamp.${skipped?` <span class="red">${skipped} unit${skipped==1?'':'s'} flagged ISSUE will be skipped.</span>`:''}</p>
  <div class="row mt-4" style="gap:10px"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="confirmcheckcol">✓ Check column</button></div></section>`}
 if(s.type==='checkarea'){const v=M.st().visits.find(x=>x.id===s.visit),a=M.area(s.area),{plan,skipped}=M.checkAllPlan(v,M.visibleItems(v,a.id));
  return `<div class="sheet-back" data-close></div><section class="sheet" role="alertdialog" aria-label="Confirm check all"><div class="grab"></div><h2>Check ${plan.length} item${plan.length==1?'':'s'} in ${esc(a.name)}?</h2>
  <p class="muted font-bold mt-2">Each is stamped ${esc(user())}, now. Already-checked items keep their stamp. Notes untouched.${skipped?` <span class="red">${skipped} unit${skipped==1?'':'s'} flagged ISSUE will be skipped.</span>`:''}</p>
  <div class="row mt-4" style="gap:10px"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="confirmcheckarea">✓ Check all</button></div></section>`}
 if(s.type==='newsize')return `<div class="sheet-back" data-close></div><section class="sheet" role="dialog"><div class="grab"></div><h2>New ${s.kind} size</h2><input class="inp" id="nsname" placeholder="${s.kind==='filter'?'20X20X2':'A49'}"><div class="row mt-3" style="gap:10px"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nssave">Add size</button></div></section>`;
 return ''}

// ---------- toast with Undo ----------
let toastT=null;function toast(msg,undo){document.querySelector('.toast')?.remove();clearTimeout(toastT);const d=document.createElement('div');d.className='toast';d.setAttribute('role','status');
 d.innerHTML=`<span>${esc(msg)}</span>${undo?'<button class="btn ghost mini2" id="undocheck">Undo</button>':''}`;document.body.appendChild(d);ui.lastCheck=undo||null;
 toastT=setTimeout(()=>{d.remove();ui.lastCheck=null},6000)}
function doCheckAll(v,items,label){const r=M.checkAll(v,items,user());if(navigator.vibrate)navigator.vibrate(15);rerender();
 toast(`✓ ${r.ticked} checked${label?' in '+label:''}${r.skipped?` · ${r.skipped} ISSUE unit${r.skipped==1?'':'s'} skipped`:''}`,r.ticked?r:null);return r}

// ---------- router / render ----------
function route(){return location.hash.replace(/^#\/?/,'').split('?')[0].split('/')}
// Visible error panel instead of a blank list if init/render throws. Reset only clears the app's offline cache +
// service worker; saved PM data (localStorage) is kept.
function fatal(err){console.error(err);const app=$('#app')||document.body;
 app.innerHTML=`<main class="wrap"><div class="card mt-4" id="fatal" role="alert" style="border-color:#ef4444"><h2 class="red">Something went wrong loading the app</h2>
  <p class="muted font-bold mt-2">Your saved PM data is still on this phone. Try Reload first; if it keeps happening tap Reset app cache.</p>
  <pre class="text-sm mt-2" style="white-space:pre-wrap;word-break:break-word">${esc(String(err&&err.stack||err)).slice(0,600)}</pre>
  <div class="row mt-4" style="gap:10px"><button class="btn ghost" id="fatalreload">↻ Reload</button><button class="btn primary" id="fatalreset">Reset app cache</button></div></div></main>`;
 $('#fatalreload').onclick=()=>location.reload();
 $('#fatalreset').onclick=async()=>{try{for(const r of await navigator.serviceWorker?.getRegistrations?.()||[])await r.unregister();for(const k of await caches.keys())await caches.delete(k)}catch(e){}location.reload()}}
window.addEventListener('error',e=>{if(!$('#app')?.children.length)fatal(e.error||e.message)});
function render(){try{render0()}catch(e){fatal(e)}}
function render0(){const y=scrollY,app=$('#app'),gw=$('#grid'),gs=gw&&render.keep?[gw.scrollLeft,gw.scrollTop]:null;
 if(!user()){app.innerHTML=login();return}
 const p=route();let h;
 if(p[0]==='l'&&M.loc(p[1])){const l=M.loc(p[1]);
  if(p[2]==='a'){const a=M.area(p[3]);h=a?areaView(l,a):locView(l)}else if(p[2]==='visits')h=visitsView(l);else if(p[2]==='report')h=reportView(l);
  else if(p[2]==='parts')h=partsView(l);else if(p[2]==='history')h=historyView(l);else if(p[2]==='schedule'&&l.schedule)h=scheduleView(l);else h=locView(l)}
 else if(p[0]==='settings'){if(!isOwner())h=home();
  else if(p[1]==='l'&&M.loc(p[2])&&p[3]==='groups')h=settingsGroups(M.loc(p[2]));else if(p[1]==='l'&&M.loc(p[2])&&p[3]==='g'&&M.group(p[2],p[4]))h=settingsGroup(M.loc(p[2]),M.group(p[2],p[4]));else if(p[1]==='l'&&M.loc(p[2]))h=settingsLoc(M.loc(p[2]));else if(p[1]==='a'&&M.area(p[2]))h=settingsArea(M.area(p[2]));
  else if(p[1]==='u'){const aid=new URLSearchParams(location.hash.split('?')[1]).get('area')||M.unit(p[2])?.areaId;h=settingsArea(M.area(ui.draft&&ui.draft._for?.startsWith(p[2])?ui.draft.areaId:aid)||M.area(aid))+settingsUnit(p[2],aid)}
  else if(p[1]==='sizes')h=settingsSizes(p[2]==='belt'?'belt':'filter');else if(p[1]==='archived')h=settingsArchived();else h=settingsHome()}
 else if(p[0]==='import')h=importView();else h=home();
 app.innerHTML=h+sheetHtml();document.title='West Mechanical PM Tracker';if(gs&&$('#grid')){$('#grid').scrollLeft=gs[0];$('#grid').scrollTop=gs[1]}
 if(render.keep)scrollTo(0,y);render.keep=false}
function rerender(){render.keep=true;render()}
const ctxLoc=()=>{const p=route();return p[0]==='l'?M.loc(p[1]):null};
function readDraft(){const d=ui.draft;if(!d)return;const n=$('#uname');if(n)d.name=n.value;const a=$('#uarea');if(a)d.areaId=a.value;
 document.querySelectorAll('[data-q]').forEach(e=>{const [k,i]=e.dataset.q.split('|');d[k][i].qty=Math.max(1,+e.value||1)});
 document.querySelectorAll('[data-sz]').forEach(e=>{const [k,i]=e.dataset.sz.split('|');if(e.value!=='__new')d[k][i].sizeId=e.value});
 document.querySelectorAll('[data-chk]').forEach(e=>d.checks[e.dataset.chk]=e.checked);['asset','notes'].forEach(k=>{const e=$('#u'+k);if(e)d[k]=e.value});const uc=$('#ucad');if(uc)d.cadence=uc.value;const ug=$('#ugroup');if(ug)d.equipmentGroupId=ug.value;const av=$('#uaddvisit');if(av)d.addToVisit=av.checked}
async function shareFile(blob,name){return sharePdf(blob,name)}

document.addEventListener('click',async e=>{const t=e.target.closest('button,[data-name],[data-close]');if(!t)return;const u=user();
 if(t.dataset.name){S.setUser(t.dataset.name);render();return}
 if(t.dataset.close!==undefined){ui.sheet=null;rerender();return}
 if(t.id==='userchip'){S.setUser(null);render();return}
 if(t.dataset.mode){ui.mode=t.dataset.mode;rerender();return}
 const l=ctxLoc(),v=l&&M.currentVisit(l.id);
 if(t.dataset.field){const cur=v.records[t.dataset.item]?.[t.dataset.field]?.v;S.setField(v,t.dataset.item,t.dataset.field,!cur,u);if(navigator.vibrate)navigator.vibrate(10);rerender();return}
 if(t.dataset.edit){const [item,field]=t.dataset.edit.split('|');ui.sheet={type:'time',visit:v.id,item,field};rerender();return}
 if(t.id==='savetime'){const s=ui.sheet,vv=M.st().visits.find(x=>x.id===s.visit);const iso=new Date(`${$('#tdate').value}T${$('#ttime').value}`).toISOString?.();
  try{S.editStampTime(vv,s.item,s.field,new Date(`${$('#tdate').value}T${$('#ttime').value}`).toISOString(),u);ui.sheet=null;rerender()}catch(err){$('#terr').textContent=err.message.includes('Invalid')?'Pick a valid date and time':err.message}return}
 if(t.dataset.layout){ui.layout=t.dataset.layout;localStorage.setItem('wmpm.layout',ui.layout);rerender();return}
 if(t.dataset.gunit){ui.sheet={type:'unit',visit:v.id,item:t.dataset.gunit};rerender();return}
 if(t.dataset.gcol){ui.sheet={type:'checkcol',visit:v.id,field:t.dataset.gcol,area:t.dataset.garea||null};rerender();return}
 if(t.dataset.tagpick){ui.sheet={type:'tagpick',loc:l.id,group:t.dataset.tagpick};rerender();return}
 if(t.id==='savetags'){const s=ui.sheet;const ids=[...document.querySelectorAll('[data-tagu]:checked')].map(e=>e.dataset.tagu);ui.sheet=null;M.tagUnits(s.loc,s.group,ids,u);rerender();toast(`🏷 ${ids.length} unit${ids.length==1?'':'s'} tagged to ${M.group(s.loc,s.group).name}`);return}
 if(t.dataset.startreg){M.newVisit(l.id,t.dataset.startreg,null,null,u);rerender();return}
 if(t.id==='confirmcheckcol'){const s=ui.sheet;ui.sheet=null;const vv=M.st().visits.find(x=>x.id===s.visit);const its=M.visibleItems(vv,s.area||undefined).filter(i=>ui.mode==='all'||M.remaining(vv,i));
  const r=M.checkAll(vv,its,u,s.field);window.__lastCheckAll=r;rerender();toast(`✓ ${M.fieldDef(s.field).label}: ${r.ticked} checked${r.skipped?` · ${r.skipped} ISSUE unit${r.skipped==1?'':'s'} skipped`:''}`,r.ticked?r:null);return}
 if(t.dataset.checkall){const it=v.items.find(i=>i.id===t.dataset.checkall);window.__lastCheckAll=doCheckAll(v,[it],M.itemName(it));return}
 if(t.dataset.checkarea){ui.sheet={type:'checkarea',visit:v.id,area:t.dataset.checkarea};rerender();return}
 if(t.id==='confirmcheckarea'){const s=ui.sheet;ui.sheet=null;const vv=M.st().visits.find(x=>x.id===s.visit);window.__lastCheckAll=doCheckAll(vv,M.visibleItems(vv,s.area),M.area(s.area).name);return}
 if(t.id==='undocheck'){if(ui.lastCheck){M.undoCheckAll(ui.lastCheck,u);ui.lastCheck=null}document.querySelector('.toast')?.remove();rerender();return}
 if(t.dataset.issue){const cur=v.records[t.dataset.issue]?.issue?.v;S.setField(v,t.dataset.issue,'issue',!cur,u);rerender();return}
 if(t.id==='startvisit'){ui.noAuto=true;M.newVisit(l.id,$('#tpl').value,$('#vlabel').value.trim(),$('#vdate').value,u);ui.mode='all';location.hash='#/l/'+l.id;return}
 if(t.dataset.open){ui.noAuto=true;M.st().currentVisit[l.id]=t.dataset.open;S.save();location.hash='#/l/'+l.id;return}
 if(t.dataset.complete||t.dataset.reopen){const x=M.st().visits.find(q=>q.id===(t.dataset.complete||t.dataset.reopen));x.status=t.dataset.complete?'completed':'active';x.updatedAt=S.now();x.updatedBy=u;S.logChange('visit',x.id,'status',x.status,u);S.save();rerender();return}
 if(t.dataset.group){const g=M.group(l.id,t.dataset.group),due=M.codesIn(g,M.curMonth()),mv=M.monthVisit(l.id);
  if(due.length&&mv&&mv.groupCodes?.[g.id]){M.st().currentVisit[l.id]=mv.id;S.save();ui.noAuto=true;location.hash='#/l/'+l.id;return}
  ui.sheet={type:'group',lid:l.id,gid:g.id,codes:due.length?[...due]:M.defaultCodes(g)};rerender();return}
 if(t.id==='startgroup'){const s=ui.sheet,codes=[...document.querySelectorAll('[data-gcode]')].filter(x=>x.checked).map(x=>x.dataset.gcode);if(!codes.length)return;
  M.startGroupVisit(s.lid,s.gid,codes,u);ui.sheet=null;ui.noAuto=true;location.hash='#/l/'+s.lid;return}
 if(t.dataset.openv){M.st().currentVisit[l.id]=t.dataset.openv;S.save();ui.noAuto=true;location.hash='#/l/'+l.id;return}
 if(t.dataset.kind){ui.reportKind=t.dataset.kind;rerender();return}
 if(t.id==='mkpdf'){const area=ui.reportArea==='all'?null:M.area(ui.reportArea);
  const {blob,name,meta}=buildReport({loc:l,area,visit:v,tech:u,kind:ui.reportKind,includeParts:ui.parts,includeLog:ui.log});
  window.__lastReport={name,size:blob.size,meta};await sharePdf(blob,name);return}
 if(t.dataset.imp){ui.imp=t.dataset.imp;document.querySelectorAll('[data-imp]').forEach(b=>b.classList.toggle('on',b===t));return}
 if(t.id==='doimport'){let txt=$('#csvtext').value;const f=$('#csvfile').files[0];if(f&&!txt.trim())txt=await f.text();
  try{const r=applyImport(parseCsv(txt),ui.imp||'add',u);$('#impresult').innerHTML=`<span class="green">✓ ${r.rows} rows · ${r.added} units added${r.removed?` · ${r.removed} archived`:''}${r.newLocations?` · ${r.newLocations} new location(s)`:''}</span>`}
  catch(err){$('#impresult').innerHTML=`<span class="red">✗ ${esc(err.message)}</span>`}return}
 // ---- settings (owner only) ----
 if(!isOwner())return;
 if(t.id==='addloc'){const n=$('#newloc').value.trim();if(n){M.addLocation(n,u);rerender()}return}
 if(t.dataset.addarea){const n=$('#newarea').value.trim();if(n){M.addArea(t.dataset.addarea,n,u);rerender()}return}
 if(t.dataset.up||t.dataset.down){const [c,id]=(t.dataset.up||t.dataset.down).split('|');M.move(c,id,t.dataset.up?-1:1,u);rerender();return}
 if(t.dataset.saveent){const [c,id]=t.dataset.saveent.split('|');M.rename(c,id,$('#ename').value,u);if($('#esub')&&$('#esub').value!==(M.loc(id).sub||''))M.setAttr('locations',id,'sub',$('#esub').value,u);rerender();return}
 if(t.dataset.del){const [c,id]=t.dataset.del.split('|');readDraft();ui.sheet={type:'confirm',coll:c,id,name:M.byId(c,id).name,count:M.logCount(c,id)};rerender();return}
 if(t.id==='confirmdel'){const s=ui.sheet;M.archive(s.coll,s.id,u);ui.sheet=null;ui.draft=null;
  if(s.coll==='units')location.hash='#/settings/a/'+M.unit(s.id).areaId;else if(s.coll==='areas')location.hash='#/settings/l/'+M.area(s.id).locationId;else if(s.coll==='locations')location.hash='#/settings';else rerender();return}
 if(t.dataset.restore){const [c,id]=t.dataset.restore.split('|');M.restore(c,id,u);rerender();return}
 if(t.dataset.addgroup){const n=$('#newgroup').value.trim();if(n){M.addGroup(t.dataset.addgroup,n,u);rerender()}return}
 if(t.dataset.garch){const [gid,a]=t.dataset.garch.split('|');M.updateGroup(route()[2],gid,{archived:a==='1'},u);rerender();return}
 if(t.dataset.savegroup){M.updateGroup(route()[2],t.dataset.savegroup,{name:$('#gname').value,notes:$('#gnotes').value.split('\n').map(x=>x.trim()).filter(Boolean)},u);rerender();return}
 if(t.dataset.addsize){const n=$('#newsize').value.trim();if(n){M.addSize(t.dataset.addsize,n,u);rerender()}return}
 if(t.dataset.addrow){readDraft();const k=t.dataset.addrow,kind=k==='filters'?'filter':'belt';if(ui.draft[k]===null)ui.draft[k]=[];ui.draft[k].push({qty:1,sizeId:M.sizes(kind)[0]?.id});rerender();return}
 if(t.dataset.rmrow){readDraft();const [k,i]=t.dataset.rmrow.split('|');ui.draft[k].splice(+i,1);rerender();return}
 if(t.dataset.na){readDraft();const k=t.dataset.na;ui.draft[k]=ui.draft[k]===null?[]:null;ui.draft.checks[k]=ui.draft[k]!==null;rerender();return}
 if(t.id==='nssave'){const s=ui.sheet,n=$('#nsname').value.trim();if(n){const z=M.addSize(s.kind,n,u);ui.draft[s.k][s.i].sizeId=z.id}ui.sheet=null;rerender();return}
 if(t.id==='saveunit'){readDraft();const d=ui.draft;if(!d.name.trim()){$('#uname').focus();return}
  const saved=M.saveUnit({id:d.id,name:d.name,areaId:d.areaId,filters:d.filters&&d.filters.filter(x=>x.sizeId),belts:d.belts&&d.belts.filter(x=>x.sizeId),checks:d.checks,equipmentGroupId:d.equipmentGroupId,asset:d.asset,cadence:d.cadence,notes:d.notes},u,d.addToVisit);ui.draft=null;location.hash='#/settings/a/'+saved.areaId;return}
 if(t.id==='exportbk'){const data={app:'West Mechanical PM Tracker',kind:'full-backup',exportedAt:S.now(),exportedBy:u,state:M.st(),outbox:S.outbox()};
  const blob=new Blob([JSON.stringify(data,null,1)],{type:'application/json'});const name=`WM-PM-backup-${M.today()}.json`;window.__lastBackup=data;await shareFile(blob,name);$('#bkresult').innerHTML=`<span class="green">✓ ${name}</span>`;return}
});
document.addEventListener('change',async e=>{const t=e.target;const l=ctxLoc(),u=user();
 if(t.dataset.note!==undefined){const v=M.currentVisit(l.id);const cur=v.records[t.dataset.note]?.note?.v||'';if(t.value!==cur)S.setField(v,t.dataset.note,'note',t.value,u)}
 if(t.id==='rarea'){ui.reportArea=t.value;rerender()}
 if(t.id==='rparts')ui.parts=t.checked;if(t.id==='rlog')ui.log=t.checked;
 if(!isOwner())return;
 if(t.dataset.feat){const [lid,f]=t.dataset.feat.split('|');const L=M.loc(lid);const feats={...(L.features||{}),[f]:t.checked,[f+'UpdatedAt']:S.now(),[f+'UpdatedBy']:u};M.setAttr('locations',lid,'features',feats,u);rerender()}
 if(t.dataset.gmonth){const [gid,m]=t.dataset.gmonth.split('|');try{M.setMonthCodes(route()[2],gid,+m,t.value.toUpperCase().split(/[\s,]+/).filter(Boolean),u);rerender()}catch(err){$('#gerr').textContent=err.message}}
 if(t.dataset.szname){M.rename('sizes',t.dataset.szname,t.value.toUpperCase(),u);rerender()}
 if(t.dataset.sz&&t.value==='__new'){readDraft();const [k,i,kind]=t.dataset.sz.split('|');ui.sheet={type:'newsize',kind,k,i:+i};rerender()}
 if(t.id==='uarea'){readDraft()}
 if(t.id==='importbk'&&t.files[0]){try{const data=JSON.parse(await t.files[0].text());if(data.kind!=='full-backup'||!data.state?.locations)throw new Error('Not a PM Tracker backup file');
  if(!confirm(`Replace ALL data on this device with the backup from ${new Date(data.exportedAt).toLocaleString()}?`))return;
  S.init(data.state);localStorage.setItem('wmpm.outbox.v1',JSON.stringify(data.outbox||[]));render();$('#bkresult').innerHTML='<span class="green">✓ Backup restored</span>'}catch(err){$('#bkresult').innerHTML=`<span class="red">✗ ${esc(err.message)}</span>`}}
});
function autoMonth(){const p=route();if(p[0]==='l'&&!p[2]&&M.loc(p[1])&&!ui.noAuto)M.ensureMonthVisit(p[1],user()||'seed');ui.noAuto=false}
addEventListener('hashchange',()=>{document.querySelector('.toast')?.remove();autoMonth();ui.mode='all';ui.sheet=null;if(!location.hash.includes('/report'))ui.reportArea='all';if(!location.hash.includes('/settings/u/'))ui.draft=null;render();scrollTo(0,0)});
addEventListener('online',()=>{Sync.syncNow(S.outbox,S.clearOutbox).finally(rerender)});addEventListener('offline',rerender);

export async function boot(){try{S.load();
 try{const seed=await (await fetch('data/seed.json')).json();const fresh=!M.st();const n=M.applySeed(seed,user()||'seed');if(fresh)localStorage.setItem('wmpm.outbox.v1','[]')}catch(e){console.error('seed/migration failed',e);if(!M.st())throw e}
 M.migrateState();if(user())autoMonth();render()}catch(e){fatal(e)}}
window.WM={S,Sync,M,render,ui};
boot().catch(fatal);

if('serviceWorker' in navigator&&location.protocol!=='file:'){navigator.serviceWorker.register('sw.js').then(reg=>{
 const show=w=>{const b=document.createElement('button');b.className='update';b.textContent='Update ready — tap to reload';b.onclick=()=>w.postMessage('SKIP_WAITING');document.body.appendChild(b)};
 if(reg.waiting&&navigator.serviceWorker.controller)show(reg.waiting);
 reg.addEventListener('updatefound',()=>{const w=reg.installing;w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)show(w)})});
});let reloaded=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloaded){reloaded=true;location.reload()}})}
