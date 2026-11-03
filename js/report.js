import * as MD from './model.js';
import {LOGO_PNG,LOGO_RATIO,BRAND} from './brand-data.js';
// On-device PDF issue report (jsPDF, vendored at vendor/jspdf.umd.min.js). No network.
const pad=n=>String(n).padStart(2,'0');
const compact=s=>s.replace(/[^A-Za-z0-9]+/g,'');
export function reportFileName(loc,area,visit){return `PM-${visit.date}-${compact(area?area.name:loc.name)}.pdf`}
export function buildReport({loc,area,visit,tech,kind,includeParts,includeLog=true}){const meta={issues:[],log:[]};const helpers=MD;const fl=i=>i.kind==='unit'?(MD.unit(i.unitId)?.flags||[]):[];
  const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'pt',format:'letter'});
  const W=612,M=48;let y=56;
  const need=h=>{if(y+h>740){doc.addPage();y=56}};
  const text=(s,x,size,style,color)=>{doc.setFont('helvetica',style||'normal');doc.setFontSize(size);doc.setTextColor(...(color||[17,17,17]));
    const lines=doc.splitTextToSize(String(s),W-x-M);need(lines.length*size*1.25);doc.text(lines,x,y);y+=lines.length*size*1.25;};
  const areas=area?[area]:MD.areasOf(loc.id,true).filter(a=>visit.items.some(i=>MD.itemArea(i)===a.id));const items=visit.items.filter(i=>areas.some(a=>a.id===MD.itemArea(i))&&(visit.status!=='active'||!MD.itemGone(i)||MD.itemIssue(visit,i)));
  const an=a=>a.name+(a.archived?' (removed)':'');
  const s=helpers.stats(visit,items.filter(i=>visit.status!=='active'||!MD.itemGone(i)));const gen=new Date();
  const hx=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));doc.setFillColor(...hx(BRAND.dark));doc.rect(0,0,W,64,'F');doc.setFillColor(...hx(BRAND.arrow));doc.rect(0,64,W,3,'F');
  doc.addImage(LOGO_PNG,'PNG',M,10,44*LOGO_RATIO,44);meta.logo=true;doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(...hx(BRAND.text));doc.text('PM Tracker',W-M,38,{align:'right'});y=92;

  text(`${kind} Report – ${loc.name}${area?' – '+an(area):' – All areas'}`,M,18,'bold');
  text(`${loc.sub||''}`,M,10,'normal',[90,90,90]);
  text(`Visit: ${visit.label} · Visit date: ${visit.date} · Tech: ${tech}`,M,10);
  text(`Progress: ${s.done}/${s.total} items (${s.pct}%) · ${s.issues} flagged issue${s.issues==1?'':'s'} · Generated ${gen.toLocaleString()}`,M,10,'normal',[90,90,90]);
  text('Internal use only. A receipt of work performed — not a disciplinary record.',M,8,'italic',[120,120,120]);y+=8;
  for(const a of areas){const iss=items.filter(i=>MD.itemArea(i)===a.id&&helpers.itemIssue(visit,i));if(!iss.length)continue;
    need(40);y+=6;text(`${an(a).toUpperCase()} (${iss.length})`,M,11,'bold',[180,83,9]);doc.setDrawColor(220);doc.line(M,y-6,W-M,y-6);y+=4;
    for(const i of iss){const r=visit.records[i.id];const start=y;need(46);
      text(MD.itemName(i),M+10,11,'bold');meta.issues.push(MD.itemName(i));text(r.note?.v?r.note.v:'(no note)',M+10,10);
      text(`Flagged by ${r.issue.by} · ${new Date(r.issue.at).toLocaleString()}${r.note?.v?` · note by ${r.note.by}`:''}`,M+10,8,'normal',[100,100,100]);
      if(fl(i).length)text('Data note: '+fl(i).join('; '),M+10,8,'italic',[150,90,0]);
      doc.setDrawColor(225,29,72);doc.setLineWidth(3);doc.line(M+2,Math.max(start-10,48),M+2,y-6);doc.setLineWidth(1);y+=6;}
  }
  if(!s.issues){y+=6;text('No flagged issues.',M,11,'normal',[60,60,60])}
  const quirks=items.filter(i=>fl(i).length);
  if(quirks.length){y+=10;text('DATA REVIEW NOTES (from source sheet)',M,10,'bold',[180,83,9]);quirks.forEach(i=>text(`• ${MD.itemName(i)}: ${fl(i).join('; ')}`,M+6,9))}
  if(includeParts){const p=helpers.partsList(visit,items.filter(i=>!MD.itemGone(i)||visit.status!=='active'));if(p.filters.length||p.belts.length||p.filtersSpecial?.length){y+=10;need(60);text('PARTS LIST (qty × size, all units in scope)',M,11,'bold',[180,83,9]);
    const col=(t,rows,left)=>{if(!rows.length)return;text(t,M+6,10,'bold');rows.forEach(([k,n])=>text(`${k}: ${n} total${left[k]?` · ${left[k]} still to change`:''}`,M+16,9))};
    col('Filters',p.filters,p.filtersLeft);col('Filters — washable / qty not given (listed separately)',p.filtersSpecial||[],{});col('Belts',p.belts,p.beltsLeft);col('Belts — qty not given',p.beltsSpecial||[],{})}}
  if(includeLog){const rows=[];for(const i of items)for(const [f,r] of Object.entries(visit.records[i.id]||{}))if(f!=='note'&&f!=='issue'&&r.v)rows.push({i,f,r});
    if(rows.length){y+=10;need(40);text('CHECK LOG (who / when)',M,11,'bold',[180,83,9]);
      for(const {i,f,r} of rows){const line=`${MD.itemName(i)} — ${MD.fieldDef(f).label} — ${r.by}, ${new Date(r.at).toLocaleString()}${r.editedAt?' (edited; logged '+new Date(r.originalLoggedAt).toLocaleString()+')':''}`;
        meta.log.push({unit:MD.itemName(i),field:MD.fieldDef(f).label,at:r.at,edited:!!r.editedAt,line});text(line,M+6,8)}}}
  const pages=doc.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(130);doc.text(`Page ${i} of ${pages}`,W-M,770,{align:'right'})}
  const name=reportFileName(loc,area,visit);return {blob:doc.output('blob'),name,meta};
}
export async function sharePdf(blob,name){
  const file=new File([blob],name,{type:'application/pdf'});
  // iOS: Web Share API with a File -> "Save to Files"
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:name});return 'shared'}catch(e){if(e.name==='AbortError')return 'cancelled'}}
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);return 'downloaded';
}
