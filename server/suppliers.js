import {json,failure,bodyJson,sameOrigin,requireAdmin,schema} from './cloud.js';
import {emailValue} from './auth.js';

const field=(value,max)=>String(value??'').trim().slice(0,max);
const now=()=>new Date().toISOString();

async function supplierSchema(env){
  await schema(env);
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_suppliers (id TEXT PRIMARY KEY, company TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT \'\', email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT \'\', notes TEXT NOT NULL DEFAULT \'\', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_suppliers_company ON mm_suppliers(company)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_supplier_products (supplier_id TEXT NOT NULL, product_id TEXT NOT NULL, PRIMARY KEY(supplier_id,product_id))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS mm_supplier_products_product ON mm_supplier_products(product_id)')
  ]);
}

function supplierInput(data){
  const company=field(data.company,120),contactName=field(data.contactName,80),email=emailValue(data.email),phone=field(data.phone,40),notes=field(data.notes,1000);
  if(!company)throw failure('공급업체명을 입력해 주세요.');
  if(!Array.isArray(data.productIds)||data.productIds.length>50)throw failure('취급 제품은 최대 50개까지 선택할 수 있습니다.');
  const productIds=[...new Set(data.productIds.map(value=>field(value,150)))];
  if(productIds.some(value=>!value))throw failure('제품을 다시 선택해 주세요.');
  return {company,contactName,email,phone,notes,active:data.active!==false,productIds};
}

async function productLinks(env,ids){
  if(!ids.length)return [];
  const rows=await env.DB.prepare(`SELECT id FROM mm_products WHERE id IN (${ids.map(()=>'?').join(',')}) AND deleted=0`).bind(...ids).all();
  if(rows.results.length!==ids.length)throw failure('존재하지 않는 제품이 포함되어 있습니다. 목록을 새로고침해 주세요.',409);
  return ids;
}

async function hydrate(env,rows){
  if(!rows.length)return [];
  const ids=rows.map(row=>row.id);
  const links=await env.DB.prepare(`SELECT supplier_id,product_id FROM mm_supplier_products WHERE supplier_id IN (${ids.map(()=>'?').join(',')}) ORDER BY product_id`).bind(...ids).all();
  const byId=new Map(ids.map(id=>[id,[]]));
  for(const link of links.results)byId.get(link.supplier_id)?.push(link.product_id);
  return rows.map(row=>({id:row.id,company:row.company,contactName:row.contact_name,email:row.email,phone:row.phone,notes:row.notes,active:!!row.active,productIds:byId.get(row.id),createdAt:row.created_at,updatedAt:row.updated_at}));
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
  const data=supplierInput(await bodyJson(request,12000));
  await productLinks(env,data.productIds);
  const at=now();
  if(id){
    const old=await env.DB.prepare('SELECT id FROM mm_suppliers WHERE id=?').bind(id).first();
    if(!old)throw failure('공급업체를 찾을 수 없습니다.',404);
    await env.DB.batch([
      env.DB.prepare('UPDATE mm_suppliers SET company=?,contact_name=?,email=?,phone=?,notes=?,active=?,updated_at=? WHERE id=?').bind(data.company,data.contactName,data.email,data.phone,data.notes,Number(data.active),at,id),
      env.DB.prepare('DELETE FROM mm_supplier_products WHERE supplier_id=?').bind(id),
      ...data.productIds.map(productId=>env.DB.prepare('INSERT INTO mm_supplier_products VALUES (?,?)').bind(id,productId))
    ]);
  }else{
    const newId=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO mm_suppliers VALUES (?,?,?,?,?,?,?,?,?)').bind(newId,data.company,data.contactName,data.email,data.phone,data.notes,Number(data.active),at,at),
      ...data.productIds.map(productId=>env.DB.prepare('INSERT INTO mm_supplier_products VALUES (?,?)').bind(newId,productId))
    ]);
    return json({supplier:(await hydrate(env,[await env.DB.prepare('SELECT * FROM mm_suppliers WHERE id=?').bind(newId).first()]))[0]},201);
  }
  return json({supplier:(await hydrate(env,[await env.DB.prepare('SELECT * FROM mm_suppliers WHERE id=?').bind(id).first()]))[0]});
}
