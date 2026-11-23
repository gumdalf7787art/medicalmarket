import {failure, json, sameOrigin, requireAdmin, bodyJson} from './cloud.js';
import {supplierSchema} from './suppliers.js';
import {sources, pilot, collect, compact} from './discovery-sources.js';
import {discoveryPhoto} from './discovery-photo.js';
import {prepareInbodyProduct} from './inbody-catalog.js';

export async function discoverySchema(env) {
  await supplierSchema(env);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_discovery_photos(supplier_id TEXT,identity TEXT,image TEXT NOT NULL,PRIMARY KEY(supplier_id,identity))').run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mm_discovery (
    supplier_id TEXT NOT NULL, identity TEXT NOT NULL, maker TEXT NOT NULL, model TEXT NOT NULL,
    source_url TEXT NOT NULL, observed_at TEXT NOT NULL, decision TEXT DEFAULT '', product_id TEXT DEFAULT '', approval_token TEXT DEFAULT '',
    PRIMARY KEY(supplier_id,identity))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mm_discovery_categories (
    supplier_id TEXT NOT NULL, identity TEXT NOT NULL, category TEXT NOT NULL,
    PRIMARY KEY(supplier_id,identity))`).run();
}

export function recommendedCategory(row) {
  const model=compact(row.model);
  if(row.maker===sources.inbody.maker && /^inbodyj?\d/.test(model))return '20f010';
  if(row.maker===sources.alpinion.maker){
    if(/^(xcubei\d|minisono)/.test(model))return '201040';
    if(/^[xe]cube/.test(model))return '201010';
    if(/^alpius/.test(model))return '40';
    if(/^vifu/.test(model))return '40';
  }
  if(row.maker===sources.bistos0340.maker){
    const categories={bt100:'c010',bt1000:'40',bt200l:'201060',bt800:'3010',bt350:'201050',bt36:'c01020',bt400:'20j030',bt410:'804020',bt500:'20j010',bt550:'20j020',bt770:'202050'};
    return categories[model]||'';
  }
  return '';
}

function makerKey(value) {
  const clean = compact(value).replace(/\(주\)|주식회사/g,'');
  if (['알피니언','alpinion','alpinionmedicalsystems'].includes(clean)) return '알피니언메디칼시스템';
  return ({inbody:'인바디',bistos:'비스토스'})[clean] || clean;
}

function groupedModel(value, model) {
  const base = String(value).split('(')[0].split(/[/,]/).map(compact);
  const prefix = base[0].match(/^[a-z]+/)?.[0] || '';
  return base.some(part=>part===model || prefix+part===model);
}

export function classify(draft, products, links) {
  const maker = makerKey(draft.maker), model = compact(draft.model);
  const matches = products.filter(p=>makerKey(p.maker)===maker && groupedModel(p.model,model));
  const exact = matches.filter(p=>compact(p.model)===model);
  const linked = exact.length===1 && links.has(JSON.stringify([draft.supplier_id,exact[0].id]));
  return {kind:linked?'linked':matches.length===1 && exact.length===1?'candidate':matches.length?'compare':'draft',matches};
}

export async function stage(env,key,items,date) {
  const source = sources[key];
  const supplier = await env.DB.prepare('SELECT s.id FROM mm_suppliers s JOIN mm_supplier_details d ON d.supplier_id=s.id WHERE d.source_key=?').bind('legacy:'+key).first();
  if (!supplier) throw failure(source.maker+'의 기존 공급업체 등록을 확인해 주세요.',409);
  const rows = items.map(({model,url})=>env.DB.prepare(`INSERT INTO mm_discovery
    (supplier_id,identity,maker,model,source_url,observed_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(supplier_id,identity) DO UPDATE SET source_url=excluded.source_url, observed_at=excluded.observed_at
    WHERE excluded.observed_at >= mm_discovery.observed_at`).bind(supplier.id,compact(source.maker)+'/'+compact(model),source.maker,model,url||source.url,date));
  for(const item of items.filter(item=>item.image)){
    rows.push(env.DB.prepare('INSERT OR REPLACE INTO mm_discovery_photos VALUES(?,?,?)').bind(supplier.id,compact(source.maker)+'/'+compact(item.model),item.image));
  }
  for(let i=0;i<rows.length;i+=40) await env.DB.batch(rows.slice(i,i+40));
}

async function catalog(env) {
  const db=env.DB;
  const [products,links] = await db.batch([
    db.prepare("SELECT id,revision,json_extract(payload,'$.name') name,json_extract(payload,'$.maker') maker,json_extract(payload,'$.model') model FROM mm_products WHERE deleted=0 ORDER BY id"),
    db.prepare('SELECT supplier_id,product_id FROM mm_supplier_products')
  ]);
  return {products:products.results,links:new Set(links.results.map(r=>JSON.stringify([r.supplier_id,r.product_id])))};
}

export async function listDiscovery(env) {
  const rows = await env.DB.prepare(`SELECT d.*,s.company,c.category FROM mm_discovery d JOIN mm_suppliers s ON s.id=d.supplier_id
    LEFT JOIN mm_discovery_categories c ON c.supplier_id=d.supplier_id AND c.identity=d.identity ORDER BY s.company,d.model`).all();
  const {products,links}=await catalog(env);
  return rows.results.map(row=>({...row,recommendedCategory:recommendedCategory(row),...classify(row,products,links)}));
}

async function approve(env,data) {
  const db=env.DB;
  const row=await db.prepare('SELECT * FROM mm_discovery WHERE supplier_id=? AND identity=?').bind(data.supplier,data.identity).first();
  if(!row || row.decision) throw failure('처리 상태가 변경되었습니다. 목록을 다시 확인해 주세요.',409);
  const {products,links}=await catalog(env);
  const {kind,matches}=classify(row,products,links);
  const publishing=data.action==='publish';
  if(publishing && kind!=='draft') throw failure('일치 후보가 있습니다. 기존 제품을 먼저 확인해 주세요.',409);
  const target=matches.find(p=>p.id===data.product);
  if(!publishing && !target) throw failure('연결할 기존 제품을 다시 선택해 주세요.',409);
  if(publishing && (!/^([a-z0-9]{2}){1,3}$/.test(data.category||'') || typeof data.name!=='string' || !data.name.trim() || data.name.trim().length>300)) throw failure('제품명과 카테고리를 확인해 주세요.');
  const id=publishing?'discovered-'+crypto.randomUUID():target.id;
  const at=new Date().toISOString();
  // Claim the review against the same catalog snapshot. D1 batches are atomic.
  const revisionTotal=products.reduce((n,p)=>n+p.revision,0);
  const token=crypto.randomUUID();
  const approved="EXISTS(SELECT 1 FROM mm_discovery WHERE supplier_id=? AND identity=? AND approval_token=?)";
  const guard=[row.supplier_id,row.identity,token];
  const claim=db.prepare(`UPDATE mm_discovery SET decision=?, product_id=?, approval_token=?
    WHERE supplier_id=? AND identity=? AND decision='' AND (SELECT COUNT(*) FROM mm_products WHERE deleted=0)=?
    AND (SELECT COALESCE(SUM(revision),0) FROM mm_products WHERE deleted=0)=?`)
    .bind(publishing?'published':'connected',id,token,row.supplier_id,row.identity,products.length,revisionTotal);
  const statements=[claim];
  if(publishing) {
    const photo=await db.prepare('SELECT image FROM mm_discovery_photos WHERE supplier_id=? AND identity=?').bind(row.supplier_id,row.identity).first();
    const product=await prepareInbodyProduct(discoveryPhoto({id,name:data.name.trim(),maker:row.maker,model:row.model,categoryIds:[data.category],published:true,deleted:false,image:photo?.image||'',gallery:photo?[photo.image]:[],imageFit:'contain',descriptionHtml:'',updatedAt:at}));
    statements.push(db.prepare('INSERT INTO mm_products (id,payload,published,deleted,revision,updated_at) SELECT ?,?,1,0,1,? WHERE '+approved).bind(id,JSON.stringify(product),at,...guard));
  }
  statements.push(db.prepare('INSERT OR IGNORE INTO mm_supplier_products(supplier_id,product_id) SELECT ?,? WHERE '+approved).bind(row.supplier_id,id,...guard));
  const result=await db.batch(statements);
  if(result[0].meta.changes!==1) throw failure('다른 화면에서 목록이 변경되었습니다. 다시 확인해 주세요.',409);
}

export async function discoveryAction({request,env}) {
  await requireAdmin(request,env);
  if(request.method==='POST') sameOrigin(request);
  await discoverySchema(env);
  if(request.method==='GET') return json({rows:await listDiscovery(env)});
  if(request.method!=='POST') throw failure('지원하지 않는 요청입니다.',405);
  const data=await bodyJson(request,3000);
  if(data.action==='category'){
    if(typeof data.category!=='string'||!/^([a-z0-9]{2}){1,3}$/.test(data.category))throw failure('대표 카테고리를 선택해 주세요.');
    const result=await env.DB.prepare(`INSERT INTO mm_discovery_categories(supplier_id,identity,category)
      SELECT supplier_id,identity,? FROM mm_discovery WHERE supplier_id=? AND identity=? AND decision=''
      ON CONFLICT(supplier_id,identity) DO UPDATE SET category=excluded.category`).bind(data.category,data.supplier,data.identity).run();
    if(result.meta.changes!==1)throw failure('검토 목록을 다시 확인해 주세요.',409);
    return json({ok:true});
  }
  if(data.action==='scan'||data.action==='pilot') {
    if(!Object.hasOwn(sources,data.key)) throw failure('시범 공급업체를 확인해 주세요.');
    const items=data.action==='pilot'?pilot[data.key]:await collect(data.key,data.mirror===true);
    await stage(env,data.key,items,data.action==='pilot'?'2026-11-23':new Date().toISOString());
    return json({count:items.length});
  }
  if(!['publish','link'].includes(data.action)) throw failure('처리 유형을 확인해 주세요.');
  await approve(env,data);
  return json({ok:true});
}

