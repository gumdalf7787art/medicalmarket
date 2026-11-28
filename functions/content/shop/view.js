// Preserve product links indexed before the migration from the original shop.
export function onRequest({request}){
  const id=new URL(request.url).searchParams.get('it_id');
  if(!id||!/^\d{1,30}$/.test(id)){
    return new Response('제품 주소를 확인해 주세요.',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','X-Robots-Tag':'noindex'}});
  }
  return new Response(null,{status:301,headers:{
    Location:'https://medicalmarket.co.kr/product?id=managed-legacy-'+id,
    'Cache-Control':'public, max-age=3600'
  }});
}
