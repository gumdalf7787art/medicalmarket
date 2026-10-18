import categories from './search-categories.js';

// Related terms expand within a concept, never to all treatment equipment.
const groups=[
 ['자기장','자기장치료','자기장치료기','magnetic','자기장치료장비'],
 ['체외충격파','체외충격파치료','체외충격파치료기','eswt','shockwave'],
 ['초음파','ultrasound'],
 ['저주파','저주파치료','저주파치료기','tens'],
 ['간섭파','간섭파치료','간섭파치료기','ict'],
 ['기능적전기자극','기능적전기자극치료기','fes'],
 ['지속적수동운동','지속적수동운동기','cpm'],
 ['심전도','심전도기','ecg','ekg']
];
const separators=/[\s\-_.·/()[\]]/g;
export const normalizeSearch=value=>String(value||'').toLowerCase().replace(separators,'');
const literalTerms=query=>[...new Set(String(query||'').slice(0,100).trim().split(/\s+/).map(normalizeSearch).filter(Boolean))];
export function productSearchRank(product,query){
 const q=normalizeSearch(String(query||'').slice(0,100));if(!q)return 0;
 const fields=[product.name,product.model].map(normalizeSearch),terms=literalTerms(query);
 if(fields.some(v=>v===q))return 3;
 if(fields.some(v=>v.includes(q)))return 2;
 if(terms.every(t=>fields.some(v=>v.includes(t))))return 1;
 return 0;
}
function normalizedSql(expression){
 let text=`lower(${expression})`;
 for(const separator of [' ','\t','\n','\r','-','_','.','·','/','(',')','[',']'])text=`replace(${text},'${separator}','')`;
 return text;
}
export function productSearchOrderSql(query){
 const q=normalizeSearch(String(query||'').slice(0,100));if(!q)return {sql:'(0+0)',args:[]};
 const fields=['name','model'].map(f=>normalizedSql(`coalesce(json_extract(payload,'$.${f}'),'')`));
 const terms=literalTerms(query),args=[q,q,q,q,JSON.stringify(literalTerms(query))];
 const all=`NOT EXISTS(SELECT 1 FROM json_each(?) token WHERE ${fields.map(f=>`instr(${f},token.value)=0`).join(' AND ')})`;
 return {sql:`CASE WHEN ${fields.map(f=>`${f}=?`).join(' OR ')} THEN 3 WHEN ${fields.map(f=>`instr(${f},?)>0`).join(' OR ')} THEN 2 WHEN ${all} THEN 1 ELSE 0 END`,args};
}
const escapeSearchText=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function highlightProductSearch(value,query){
 const source=String(value||''),positions=[];let normalized='';
 for(let i=0;i<source.length;i++){const c=normalizeSearch(source[i]);for(const part of c){normalized+=part;positions.push(i);}}
 const terms=[normalizeSearch(String(query||'').slice(0,100)),...literalTerms(query)].filter(Boolean),ranges=[];
 for(const term of terms){let start=0,index;while((index=normalized.indexOf(term,start))!==-1){ranges.push([positions[index],positions[index+term.length-1]+1]);start=index+term.length;}}
 ranges.sort((a,b)=>a[0]-b[0]);const merged=[];
 for(const r of ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push(r);}
 let html='',cursor=0;for(const [start,end] of merged){html+=escapeSearchText(source.slice(cursor,start))+'<mark class="search-highlight">'+escapeSearchText(source.slice(start,end))+'</mark>';cursor=end;}
 return html+escapeSearchText(source.slice(cursor));
}
export function searchPlan(query){
 const raw=String(query||'').slice(0,100).trim();
 if(!raw)return [];
 const whole=normalizeSearch(raw);
 // Keep known spaced concepts together (e.g. "자기장 치료").
 const tokens=groups.some(g=>g.includes(whole))?[whole]:raw.split(/\s+/).map(normalizeSearch).filter(Boolean);
 return [...new Set(tokens)].map(token=>{
  const terms=groups.find(g=>g.includes(token))||[token];
  const categoryIds=categories.filter(c=>terms.some(t=>normalizeSearch(c.name).includes(t))).map(c=>c.id);
  return {terms,categoryIds};
 });
}
export function matchesProductSearch(product,query,categoryIds=product.categoryIds||[]){
 const text=normalizeSearch([product.name,product.model,product.maker].filter(Boolean).join(' '));
 return searchPlan(query).every(group=>group.terms.some(t=>text.includes(t))||categoryIds.some(id=>group.categoryIds.some(code=>id.startsWith(code))));
}
export function productSearchSql(query){
 let text="lower(coalesce(json_extract(payload,'$.name'),'')||' '||coalesce(json_extract(payload,'$.model'),'')||' '||coalesce(json_extract(payload,'$.maker'),''))";
 for(const separator of [' ','\t','\n','\r','-','_','.','·','/','(',')','[',']'])text=`replace(${text},'${separator}','')`;
 const args=[];
 const clauses=searchPlan(query).map(group=>{
  const parts=group.terms.map(term=>{args.push(term);return `instr(${text},?)>0`;});
  if(group.categoryIds.length){
   args.push(JSON.stringify(group.categoryIds));
   parts.push("EXISTS(SELECT 1 FROM json_each(json_extract(payload,'$.categoryIds')) pcat, json_each(?) matched WHERE substr(pcat.value,1,length(matched.value))=matched.value)");
  }
  return '('+parts.join(' OR ')+')';
 });
 return {sql:clauses.join(' AND ')||'1=1',args};
}
