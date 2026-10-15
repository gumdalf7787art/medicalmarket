export async function onRequestGet({params,env}){
  if(!/^[a-f0-9-]{36}\.webp$/.test(params.name)||!env.MEDIA)return new Response('Not found',{status:404});
  const object=await env.MEDIA.get('product-images/'+params.name);if(!object)return new Response('Not found',{status:404});
  return new Response(object.body,{headers:{'Content-Type':'image/webp','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff','ETag':object.httpEtag}});
}
