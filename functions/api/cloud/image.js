import {productConnections} from '../../../server/guide-connections.js';
import {json,sameOrigin,requireAdmin,limitedBody,safeHandler,failure} from '../../../server/cloud.js';
export const onRequestPost=safeHandler(async({request,env})=>{
  const paired=await productConnections.approved(request,env.DB);
  if(!paired){sameOrigin(request);await requireAdmin(request,env);}if(!env.MEDIA)throw failure('MEDIA 바인딩을 확인해 주세요.',503);
  const bytes=await limitedBody(request,8*1024*1024);
  // Only raster WebP produced by the editor is accepted; never serve SVG/HTML uploads.
  const ascii=(a,b)=>String.fromCharCode(...bytes.slice(a,b));
  if(bytes.length<20||ascii(0,4)!=='RIFF'||ascii(8,12)!=='WEBP'||request.headers.get('Content-Type')!=='image/webp')throw failure('웹 최적화된 WebP 사진만 저장할 수 있습니다.');
  const requestedHash=request.headers.get('X-Image-SHA256');
  if(paired&&!requestedHash&&!request.headers.has('X-Thumbnail-For'))throw failure('사진 해시가 필요합니다.');
  let name=crypto.randomUUID()+'.webp';
  const parent=request.headers.get('X-Thumbnail-For');
  if(parent){
    if(!/^[a-f0-9-]{36}\.webp$/.test(parent)||bytes.length>512*1024)throw failure('원본 사진을 확인해 주세요.');
    const original=await env.MEDIA.head('product-images/'+parent);
    if(!original)throw failure('원본 사진을 확인해 주세요.');
    name=parent.replace('.webp','-thumb.webp');
    if(paired&&(original.customMetadata?.productConnection!==paired||await env.MEDIA.head('product-images/'+name)))return json({url:'/media/'+parent+'?thumb=1'});
    await env.MEDIA.put('product-images/'+name,bytes,{httpMetadata:{contentType:'image/webp'}});
    return json({url:'/media/'+parent+'?thumb=1'});
  }
  if(requestedHash){
    const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(actual!==requestedHash)throw failure('사진 무결성 검증에 실패했습니다.');
    name=[actual.slice(0,8),actual.slice(8,12),actual.slice(12,16),actual.slice(16,20),actual.slice(20,32)].join('-')+'.webp';
    const existing=await env.MEDIA.head('product-images/'+name);
    if(existing){if(existing.customMetadata?.sha256!==actual)throw failure('사진 식별자가 중복되었습니다.',409);return json({url:'/media/'+name});}
  }
  const customMetadata=requestedHash?{sha256:requestedHash}:{};
  if(paired)customMetadata.productConnection=paired;
  await env.MEDIA.put('product-images/'+name,bytes,{httpMetadata:{contentType:'image/webp'},customMetadata});
  return json({url:'/media/'+name});
});
