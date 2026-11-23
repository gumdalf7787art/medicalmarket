import {failure} from './cloud.js';
export const origin='https://medicalmarket.co.kr';
export async function initialize(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS mm_guides (
    slug TEXT PRIMARY KEY, product_id TEXT NOT NULL, title TEXT NOT NULL,
    summary TEXT NOT NULL, body TEXT NOT NULL, images TEXT NOT NULL,
    published INTEGER NOT NULL, revision INTEGER NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
    first_published TEXT)`).run();
}
const source=` FROM mm_guides g JOIN mm_products p ON p.id=g.product_id WHERE p.published=1 AND p.deleted=0`;
const columns=`g.*,json_extract(p.payload,'$.name') name,json_extract(p.payload,'$.model') model`;
export async function list(db,q='',page=1,admin=false){
  const condition=source+(admin?'':' AND g.published=1')+` AND instr(lower(g.title||' '||g.summary||' '||json_extract(p.payload,'$.name')||' '||coalesce(json_extract(p.payload,'$.model'),'')),lower(?))>0`;
  return (await db.prepare('SELECT '+columns.replace('g.*','g.slug,g.title,g.summary,g.images,g.published,g.updated')+condition+' ORDER BY g.updated DESC,g.slug LIMIT 21 OFFSET ?').bind(q,(page-1)*20).all()).results;
}
export async function read(db,slug,admin=false){
  return db.prepare('SELECT '+columns+source+' AND g.slug=?'+(admin?'':' AND g.published=1')).bind(slug).first();
}
export async function save(db,slug,input){
  if(!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug))throw failure('글 주소에는 영문 소문자, 숫자, 하이픈을 사용하세요.');
  if(!input||typeof input!=='object')throw failure('글 데이터를 확인하세요.');
  const {productId,images=[],published,revision}=input;
  const fields=['title','summary','body'].map((key,i)=>{
    const s=input[key];if(typeof s!=='string'||!s.trim()||s.length>[200,500,60000][i])throw failure('제목, 요약, 본문 길이를 확인하세요.');return s.trim();
  });
  if(typeof published!=='boolean'||!Number.isSafeInteger(revision)||revision<0||typeof productId!=='string')throw failure('제품 또는 저장 버전을 확인하세요.');
  const product=await db.prepare('SELECT payload FROM mm_products WHERE id=? AND published=1 AND deleted=0').bind(productId).first();
  if(!product)throw failure('공개된 등록 제품을 선택하세요.');
  const p=JSON.parse(product.payload), allowed=new Set([p.image,...(p.gallery||[])].filter(Boolean));
  if(!Array.isArray(images)||images.length>50||images.some(url=>!allowed.has(url)||! /^(https:\/\/|assets\/|\/media\/)/.test(url)))throw failure('선택한 제품의 등록 사진만 사용할 수 있습니다.');
  const now=new Date().toISOString(),args=[productId,...fields,JSON.stringify([...new Set(images)]),Number(published),now];
  const result=revision===0
    ?await db.prepare('INSERT OR IGNORE INTO mm_guides(product_id,title,summary,body,images,published,updated,slug,revision,created,first_published) VALUES(?,?,?,?,?,?,?,?,1,?,?)').bind(...args,slug,now,published?now:null).run()
    :await db.prepare('UPDATE mm_guides SET product_id=?,title=?,summary=?,body=?,images=?,published=?,updated=?,first_published=coalesce(first_published,?),revision=revision+1 WHERE slug=? AND revision=?').bind(...args,published?now:null,slug,revision).run();
  if(!result.meta.changes)throw failure('글 주소가 중복되거나 다른 곳에서 수정되었습니다. 최신 글을 다시 확인하세요.',409);
  return {slug,revision:revision+1,published,url:origin+'/guide/'+slug};
}
