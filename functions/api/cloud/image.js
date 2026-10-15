import {json,sameOrigin,requireAdmin,limitedBody,safeHandler,failure} from '../../../server/cloud.js';
export const onRequestPost=safeHandler(async({request,env})=>{
  sameOrigin(request);await requireAdmin(request,env);if(!env.MEDIA)throw failure('MEDIA 바인딩을 확인해 주세요.',503);
  const bytes=await limitedBody(request,8*1024*1024);
  // Only raster WebP produced by the editor is accepted; never serve SVG/HTML uploads.
  const ascii=(a,b)=>String.fromCharCode(...bytes.slice(a,b));
  if(bytes.length<20||ascii(0,4)!=='RIFF'||ascii(8,12)!=='WEBP'||request.headers.get('Content-Type')!=='image/webp')throw failure('웹 최적화된 WebP 사진만 저장할 수 있습니다.');
  const name=crypto.randomUUID()+'.webp';
  await env.MEDIA.put('product-images/'+name,bytes,{httpMetadata:{contentType:'image/webp'}});
  return json({url:'/media/'+name});
});
