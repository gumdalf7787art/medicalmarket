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
