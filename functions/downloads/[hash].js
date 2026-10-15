import {safeHandler,failure} from '../../server/cloud.js';
export const onRequestGet=safeHandler(async({request,env,params})=>{
 if(!/^[a-f0-9]{64}$/.test(params.hash))throw failure('자료를 찾을 수 없습니다.',404);
 const product=new URL(request.url).searchParams.get('product');
 let file;try{file=await env.DB.prepare('SELECT f.name FROM mm_product_files f JOIN mm_products p ON p.id=f.product_id WHERE f.hash=? AND f.product_id=? AND p.published=1 AND p.deleted=0').bind(params.hash,product).first();}catch(e){if(!String(e).includes('no such table'))throw e;}
 if(!file)throw failure('자료를 찾을 수 없습니다.',404);
 const object=await env.MEDIA.get('product-files/'+params.hash);if(!object)throw failure('자료를 찾을 수 없습니다.',404);
 return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename=product-document; filename*=UTF-8''"+encodeURIComponent(file.name),'Content-Length':String(object.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
});
