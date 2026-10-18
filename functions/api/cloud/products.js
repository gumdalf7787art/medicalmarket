import {productSearchSql,productSearchOrderSql} from '../../../server/product-search.js';
import sanitizeHtml from 'sanitize-html';
import {json,bodyJson,sameOrigin,authenticated,requireAdmin,schema,safeHandler,failure} from '../../../server/cloud.js';
const imageUrl=value=> typeof value==='string'&&value.length<=2048&&(/^(https:\/\/[^\s"<>]+|assets\/[\w./%-]+|\/media\/[\w.-]+)$/.test(value))&&!value.includes('..');
export function cleanProduct(p){
  if(!p||typeof p!=='object')throw failure('제품 정보를 확인해 주세요.');
  const text=(key,max)=>{if(typeof p[key]!=='string'||p[key].length>max)throw failure('제품 '+key+' 항목을 확인해 주세요.');return p[key].trim();};
  const id=text('id',100),name=text('name',300);if(!/^[\w-]+$/.test(id)||!name)throw failure('제품번호와 제품명이 필요합니다.');
  if(!Array.isArray(p.categoryIds)||!p.categoryIds.length||p.categoryIds.length>3||p.categoryIds.some(v=>typeof v!=='string'||!/^([a-z0-9]{2}){1,3}$/.test(v)))throw failure('제품 카테고리를 확인해 주세요.');
  if(!Array.isArray(p.gallery)||p.gallery.length>50||p.gallery.some(v=>!imageUrl(v))||(p.image&&!imageUrl(p.image)))throw failure('제품 사진 주소를 확인해 주세요.');
  if(p.image&&!p.gallery.includes(p.image))throw failure('대표 사진은 등록 사진 중 선택해 주세요.');
  const descriptionHtml=sanitizeHtml(text('descriptionHtml',250000),{
    allowedTags:['p','div','span','br','strong','b','em','i','u','s','strike','sub','sup','h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tfoot','tr','td','th','blockquote','hr','font','a','img','figure','figcaption','iframe'],
    allowedAttributes:{'*':['style'],img:['src','alt','loading'],iframe:['src','title','allowfullscreen','loading','referrerpolicy'],a:['href','target','rel'],font:['size','color'],td:['colspan','rowspan'],th:['colspan','rowspan']},
    allowedSchemes:['https'],allowProtocolRelative:false,allowedIframeHostnames:['www.youtube-nocookie.com'],
    allowedStyles:{'*':{'color':[/^(#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i],'background-color':[/^(#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\))$/i],'font-size':[/^\d+(px|em|rem|%)$/],'font-weight':[/^(bold|normal|[1-9]00)$/],'font-style':[/^(italic|normal)$/],'text-align':[/^(left|right|center|justify)$/],'text-decoration':[/^(underline|line-through|none)$/],'width':[/^\d+(px|%)$/],'max-width':[/^\d+(px|%)$/],'height':[/^(auto|\d+px)$/],'line-height':[/^[\d.]+(px|em|%)?$/]}},
    exclusiveFilter:frame=>frame.tag==='img'&&!imageUrl(frame.attribs.src),
    transformTags:{a:sanitizeHtml.simpleTransform('a',{rel:'noopener noreferrer',target:'_blank'})}
  });
  return {id,name,model:text('model',300),maker:text('maker',300),categoryIds:p.categoryIds,published:p.published===true,deleted:p.deleted===true,image:p.image||'',gallery:[...new Set(p.gallery)],imageFit:p.imageFit==='cover'?'cover':'contain',descriptionHtml,updatedAt:new Date().toISOString()};
}
export const onRequestGet=safeHandler(async({request,env})=>{
  if(!env.DB)throw failure('DB 바인딩을 확인해 주세요.',503);
  const admin=new URL(request.url).searchParams.get('admin')==='1';if(admin)await requireAdmin(request,env);
  const params=new URL(request.url).searchParams;
  if(params.has('id')){
    const row=await env.DB.prepare('SELECT payload,revision FROM mm_products WHERE id=? '+(admin?'':'AND published=1 AND deleted=0')).bind(params.get('id')).first();
    if(!row)throw failure('제품을 찾을 수 없습니다.',404);
    return json({product:{...JSON.parse(row.payload),revision:row.revision}});
  }
  const summary=p=>({id:p.id,name:p.name,model:p.model,maker:p.maker,categoryIds:p.categoryIds,image:p.image,imageFit:p.imageFit,published:p.published,deleted:p.deleted,updatedAt:p.updatedAt,_summary:true});
  if(params.has('page')){
    const page=Math.max(1,Math.min(100000,Number.parseInt(params.get('page'))||1));
    const category=params.get('category')||'',q=(params.get('q')||'').slice(0,100).toLowerCase();
    if(category&&!/^([a-z0-9]{2}){1,3}$/.test(category))throw failure('제품 분류를 확인해 주세요.');
    const search=productSearchSql(q),order=productSearchOrderSql(q);
    const where="published=1 AND deleted=0 AND (?='' OR EXISTS(SELECT 1 FROM json_each(json_extract(payload,'$.categoryIds')) WHERE substr(value,1,length(?))=?)) AND "+search.sql;
    const args=[category,category,category,...search.args];
    const count=await env.DB.prepare('SELECT count(*) AS total FROM mm_products WHERE '+where).bind(...args).first();
    const pages=Math.max(1,Math.ceil(count.total/15)),current=Math.min(page,pages);
    const result=await env.DB.prepare("SELECT payload FROM mm_products WHERE "+where+" ORDER BY "+order.sql+" DESC,(coalesce(json_extract(payload,'$.image'),'')!='') DESC,id LIMIT 15 OFFSET ?").bind(...args,...order.args,(current-1)*15).all();
    return json({products:result.results.map(r=>summary(JSON.parse(r.payload))),total:count.total,page:current,pages});
  }
  const after=new URL(request.url).searchParams.get('after')||'';
  const limit=new URL(request.url).searchParams.get('bulk')==='1'?1000:50;
  let rows;
  try{rows=await env.DB.prepare('SELECT id,payload,revision FROM mm_products WHERE id > ? '+(admin?'':'AND published=1 AND deleted=0 ')+'ORDER BY id LIMIT ?').bind(after,limit).all();}
  catch(e){if(String(e).includes('no such table'))return json({products:[],next:null,initialized:false});throw e;}
  return json({products:rows.results.map(r=>params.get('summary')==='1'?summary(JSON.parse(r.payload)):({...JSON.parse(r.payload),revision:r.revision})),next:rows.results.length===limit?rows.results.at(-1).id:null,initialized:true});
});
export const onRequestPost=safeHandler(async({request,env})=>{
  sameOrigin(request);await requireAdmin(request,env);await schema(env);
  const data=await bodyJson(request),row=cleanProduct(data);
  const revision=data.revision??0;if(!Number.isSafeInteger(revision)||revision<0)throw failure('제품 버전을 확인해 주세요.');
  const values=[JSON.stringify(row),Number(row.published),Number(row.deleted),row.updatedAt,row.id];
  const result=revision===0
    ?await env.DB.prepare('INSERT OR IGNORE INTO mm_products(payload,published,deleted,updated_at,id,revision) VALUES (?,?,?,?,?,1)').bind(...values).run()
    :await env.DB.prepare('UPDATE mm_products SET payload=?,published=?,deleted=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').bind(...values,revision).run();
  if(result.meta.changes!==1)throw failure('다른 화면에서 제품이 변경되었습니다. 작성 내용을 복사해 둔 뒤 새로고침하여 최신 정보를 확인해 주세요.',409);
  return json({product:{...row,revision:revision+1}});
});
