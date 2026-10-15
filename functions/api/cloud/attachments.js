import {json,sameOrigin,requireAdmin,limitedBody,safeHandler,failure} from '../../../server/cloud.js';
export async function attachmentSchema(env){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS mm_product_files (product_id TEXT NOT NULL, hash TEXT NOT NULL, name TEXT NOT NULL, extension TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(product_id,hash))').run();
}
export const onRequestGet=safeHandler(async({request,env})=>{
 const admin=new URL(request.url).searchParams.get('admin')==='1';if(admin)await requireAdmin(request,env);
 let result;try{result=await env.DB.prepare('SELECT f.* FROM mm_product_files f JOIN mm_products p ON p.id=f.product_id '+(admin?'':'WHERE p.published=1 AND p.deleted=0')).all();}
 catch(error){if(String(error).includes('no such table'))return json({attachments:{}});throw error;}
 const attachments={};for(const f of result.results)(attachments[f.product_id]??=[]).push({name:f.name,extension:f.extension.toUpperCase(),size:f.size,url:'/downloads/'+f.hash+'?product='+encodeURIComponent(f.product_id)});
 return json({attachments});
});
export const onRequestPost=safeHandler(async({request,env})=>{
 sameOrigin(request);await requireAdmin(request,env);
 if(!env.MEDIA||!env.DB)throw failure('저장소 연결을 확인해 주세요.',503);
 const params=new URL(request.url).searchParams,product=params.get('product'),name=params.get('name')||'',extension=params.get('extension');
 if(!/^[\w-]{1,100}$/.test(product||'')||!name||name.length>180||/[\r\n/\\]/.test(name)||!['pdf','png','jpg'].includes(extension))throw failure('제품 첨부파일 정보를 확인해 주세요.');
 if(!await env.DB.prepare('SELECT id FROM mm_products WHERE id=?').bind(product).first())throw failure('제품을 찾을 수 없습니다.',404);
 const bytes=await limitedBody(request,32*1024*1024),hex=Array.from(bytes.slice(0,8),n=>n.toString(16).padStart(2,'0')).join('');
 if(!(extension==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'||extension==='png'&&hex==='89504e470d0a1a0a'||extension==='jpg'&&hex.startsWith('ffd8ff')))throw failure('PDF 또는 이미지 파일 형식을 확인해 주세요.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 if(hash!==request.headers.get('X-File-SHA256'))throw failure('파일 검증에 실패했습니다.');
 await attachmentSchema(env);
 const key='product-files/'+hash;
 if(!await env.MEDIA.head(key))await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:extension==='pdf'?'application/pdf':'image/'+(extension==='jpg'?'jpeg':'png')}});
 await env.DB.prepare('INSERT INTO mm_product_files(product_id,hash,name,extension,size) VALUES(?,?,?,?,?) ON CONFLICT(product_id,hash) DO UPDATE SET name=excluded.name').bind(product,hash,name,extension,bytes.length).run();
 return json({hash,size:bytes.length,url:'/downloads/'+hash+'?product='+encodeURIComponent(product)});
});
