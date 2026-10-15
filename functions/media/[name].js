export async function onRequestGet({params,env,request}){
  if(!/^[a-f0-9-]{36}\.webp$/.test(params.name)||!env.MEDIA)return new Response('Not found',{status:404});
  const thumbnail=new URL(request.url).searchParams.get('thumb')==='1';
  let object=thumbnail?await env.MEDIA.get('product-images/'+params.name.replace('.webp','-thumb.webp')):null;
  const fallback=thumbnail&&!object;
  object??=await env.MEDIA.get('product-images/'+params.name);if(!object)return new Response('Not found',{status:404});
  return new Response(object.body,{headers:{'Content-Type':'image/webp','Cache-Control':fallback?'public,max-age=60':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff','ETag':object.httpEtag,'X-Image-Variant':thumbnail&&!fallback?'thumbnail':'original'}});
}
