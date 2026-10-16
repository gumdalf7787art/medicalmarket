import {json,failure,bodyJson,sameOrigin,requireAdmin,schema} from './cloud.js';
import {emailValue} from './auth.js';

const field=(value,max)=>String(value??'').trim().slice(0,max);
const optionalEmail=value=>value?emailValue(value):'';
const now=()=>new Date().toISOString();

async function supplierSchema(env){
  await schema(env);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mm_suppliers (id TEXT PRIMARY KEY, company TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_suppliers_company ON mm_suppliers(company)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_supplier_products (supplier_id TEXT NOT NULL, product_id TEXT NOT NULL, PRIMARY KEY(supplier_id,product_id))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_supplier_products_product ON mm_supplier_products(product_id)'),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mm_supplier_details (supplier_id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, classification TEXT NOT NULL DEFAULT 'manual', review_status TEXT NOT NULL DEFAULT 'needs_review', company_phone TEXT NOT NULL DEFAULT '', company_email TEXT NOT NULL DEFAULT '', contacts_json TEXT NOT NULL DEFAULT '[]')")
  ]);
}

function supplierInput(data){
  const company=field(data.company,120),contactName=field(data.contactName,80),email=optionalEmail(data.email),phone=field(data.phone,40),notes=field(data.notes,1000);
  if(!company)throw failure('공급업체명을 입력해 주세요.');
  if(!Array.isArray(data.productIds)||data.productIds.length>400)throw failure('취급 제품은 최대 400개까지 선택할 수 있습니다.');
  const productIds=[...new Set(data.productIds.map(value=>field(value,150)))];
  if(productIds.some(value=>!value))throw failure('제품을 다시 선택해 주세요.');
  if(!Array.isArray(data.contacts||[])||(data.contacts||[]).length>30)throw failure('담당자는 최대 30명까지 등록할 수 있습니다.');
  const contacts=(data.contacts||[]).map((row,index)=>({
    id:field(row.id,100)||`contact-${index+1}`,name:field(row.name,80),phone:field(row.phone,40),mobile:field(row.mobile,40),
    email:optionalEmail(row.email),left:!!row.left,blocked:!!row.blocked
  })).filter(row=>row.name||row.phone||row.mobile||row.email);
  const classification=['manual','legacy','candidate'].includes(data.classification)?data.classification:'manual';
  const reviewStatus=['needs_review','confirmed'].includes(data.reviewStatus)?data.reviewStatus:'needs_review';
  if(classification!=='manual'&&data.active!==false&&reviewStatus!=='confirmed')throw failure('기존 업체는 확인 완료 후 사용 상태로 변경할 수 있습니다.');
  return {company,contactName,email,phone,notes,active:data.active!==false,productIds,contacts,classification,reviewStatus,
    companyPhone:field(data.companyPhone,40),companyEmail:optionalEmail(data.companyEmail)};
}

async function productLinks(env,ids){
  if(!ids.length)return [];
  const found=new Set();
  for(let start=0;start<ids.length;start+=40){
    const chunk=ids.slice(start,start+40);
    const rows=await env.DB.prepare(`SELECT id FROM mm_products WHERE id IN (${chunk.map(()=>'?').join(',')}) AND deleted=0`).bind(...chunk).all();
    for(const row of rows.results)found.add(row.id);
  }
  if(found.size!==ids.length)throw failure(`등록되지 않은 제품 ${ids.filter(id=>!found.has(id)).length}개가 포함되어 있습니다.`,409);
  return ids;
}

function linkStatements(env,id,ids){
  const statements=[];
  for(let start=0;start<ids.length;start+=40){
    const chunk=ids.slice(start,start+40);
    statements.push(env.DB.prepare(`INSERT INTO mm_supplier_products (supplier_id,product_id) VALUES ${chunk.map(()=>'(?,?)').join(',')}`).bind(...chunk.flatMap(productId=>[id,productId])));
  }
  return statements;
}

async function hydrate(env,rows){
  if(!rows.length)return [];
  const ids=rows.map(row=>row.id),placeholders=ids.map(()=>'?').join(',');
  const [links,details]=await Promise.all([
    env.DB.prepare(`SELECT supplier_id,product_id FROM mm_supplier_products WHERE supplier_id IN (${placeholders}) ORDER BY product_id`).bind(...ids).all(),
    env.DB.prepare(`SELECT * FROM mm_supplier_details WHERE supplier_id IN (${placeholders})`).bind(...ids).all()
  ]);
  const byId=new Map(ids.map(id=>[id,[]])),meta=new Map(details.results.map(row=>[row.supplier_id,row]));
  for(const link of links.results)byId.get(link.supplier_id)?.push(link.product_id);
  return rows.map(row=>{const extra=meta.get(row.id);return {id:row.id,company:row.company,contactName:row.contact_name,email:row.email,phone:row.phone,notes:row.notes,active:!!row.active,
    productIds:byId.get(row.id),createdAt:row.created_at,updatedAt:row.updated_at,classification:extra?.classification||'manual',reviewStatus:extra?.review_status||'needs_review',
    companyPhone:extra?.company_phone||row.phone,companyEmail:extra?.company_email||'',contacts:JSON.parse(extra?.contacts_json||'[]')};});
}

export async function supplierAction({request,env,params}){
  await requireAdmin(request,env);
  await supplierSchema(env);
  const id=Array.isArray(params.path)?params.path[0]:params.path||'';
  if(request.method==='GET'){
    if(id){const row=await env.DB.prepare('SELECT * FROM mm_suppliers WHERE id=?').bind(id).first();if(!row)throw failure('공급업체를 찾을 수 없습니다.',404);return json({supplier:(await hydrate(env,[row]))[0]});}
    const url=new URL(request.url),page=Math.max(1,Math.min(10000,Math.floor(Number(url.searchParams.get('page')))||1)),q=field(url.searchParams.get('q'),100),pattern='%'+q+'%';
    const total=await env.DB.prepare('SELECT COUNT(*) AS total FROM mm_suppliers WHERE company LIKE ? OR contact_name LIKE ? OR email LIKE ?').bind(pattern,pattern,pattern).first();
    const rows=await env.DB.prepare('SELECT * FROM mm_suppliers WHERE company LIKE ? OR contact_name LIKE ? OR email LIKE ? ORDER BY active DESC,company,id LIMIT 20 OFFSET ?').bind(pattern,pattern,pattern,(page-1)*20).all();
    return json({suppliers:await hydrate(env,rows.results),total:total.total,page});
  }
  if(request.method!=='POST')throw failure('지원하지 않는 요청입니다.',405);
  sameOrigin(request);
  const raw=await bodyJson(request,60000),data=supplierInput(raw);
  if(id==='import'){
    const sourceKey=field(raw.sourceKey,150);
    if(!/^legacy:[A-Za-z0-9_-]{1,120}$/.test(sourceKey)||!['legacy','candidate'].includes(data.classification))throw failure('이관 원본 식별자가 올바르지 않습니다.');
    const existing=await env.DB.prepare('SELECT supplier_id FROM mm_supplier_details WHERE source_key=?').bind(sourceKey).first();
    if(existing)return json({status:'skipped',id:existing.supplier_id});
    data.active=false;data.reviewStatus='needs_review';
    await productLinks(env,data.productIds);
    const newId=crypto.randomUUID(),at=now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO mm_suppliers VALUES (?,?,?,?,?,?,?,?,?)').bind(newId,data.company,data.contactName,data.email,data.phone,data.notes,0,at,at),
      env.DB.prepare('INSERT INTO mm_supplier_details VALUES (?,?,?,?,?,?,?)').bind(newId,sourceKey,data.classification,'needs_review',data.companyPhone,data.companyEmail,JSON.stringify(data.contacts)),
      ...linkStatements(env,newId,data.productIds)
    ]);
    return json({status:'created',id:newId},201);
  }
  await productLinks(env,data.productIds);
  const at=now();
  if(id){
    const old=await env.DB.prepare('SELECT id FROM mm_suppliers WHERE id=?').bind(id).first();
    if(!old)throw failure('공급업체를 찾을 수 없습니다.',404);
    const details=await env.DB.prepare('SELECT source_key FROM mm_supplier_details WHERE supplier_id=?').bind(id).first();
    await env.DB.batch([
      env.DB.prepare('UPDATE mm_suppliers SET company=?,contact_name=?,email=?,phone=?,notes=?,active=?,updated_at=? WHERE id=?').bind(data.company,data.contactName,data.email,data.phone,data.notes,Number(data.active),at,id),
      env.DB.prepare('DELETE FROM mm_supplier_products WHERE supplier_id=?').bind(id),
      env.DB.prepare('INSERT OR REPLACE INTO mm_supplier_details VALUES (?,?,?,?,?,?,?)').bind(id,details?.source_key||`manual:${id}`,data.classification,data.reviewStatus,data.companyPhone,data.companyEmail,JSON.stringify(data.contacts)),
      ...linkStatements(env,id,data.productIds)
    ]);
  }else{
    const newId=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO mm_suppliers VALUES (?,?,?,?,?,?,?,?,?)').bind(newId,data.company,data.contactName,data.email,data.phone,data.notes,Number(data.active),at,at),
      env.DB.prepare('INSERT INTO mm_supplier_details VALUES (?,?,?,?,?,?,?)').bind(newId,`manual:${newId}`,'manual',data.reviewStatus,data.companyPhone,data.companyEmail,JSON.stringify(data.contacts)),
      ...linkStatements(env,newId,data.productIds)
    ]);
    return json({supplier:(await hydrate(env,[await env.DB.prepare('SELECT * FROM mm_suppliers WHERE id=?').bind(newId).first()]))[0]},201);
  }
  return json({supplier:(await hydrate(env,[await env.DB.prepare('SELECT * FROM mm_suppliers WHERE id=?').bind(id).first()]))[0]});
}
