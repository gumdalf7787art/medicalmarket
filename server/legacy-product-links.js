// Reviewed against the original product backup and the public catalog, 2026-11-28.
export const legacyProductAliases={
  '1697697928':'discovered-77b8b9d3-14f1-4715-85d3-b164651a8d2a',
  '1698200309':'legacy-1680594412',
  '1698720346':'legacy-1691545437',
  '1698813362':'legacy-1697002721',
  '1699251798':'legacy-1697156671',
  '1699579651':'legacy-1687330425',
  '1711339712':'legacy-1681439752'
};
const pendingIds=new Set(['1698901490','1699248741']);
function unavailable(status,title,message){
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>${title} | 메디컬마켓</title><style>body{font:17px/1.8 system-ui;color:#192b42;margin:0;padding:24px}main{max-width:680px;margin:10vh auto}a{display:inline-block;margin:12px 16px 0 0;color:#174f88}h1{font-size:28px}</style></head><body><main><a href="/">메디컬마켓</a><h1>${title}</h1><p>${message}</p><a href="/#catalog">등록된 제품 둘러보기</a><a href="/guide">제품 안내 보기</a></main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, follow'}});
}
export async function legacyProductRedirect({request,env}){
  const id=new URL(request.url).searchParams.get('it_id');
  if(!id||!/^\d{1,30}$/.test(id))return unavailable(404,'제품 주소를 확인해 주세요','요청하신 제품 주소가 올바르지 않습니다.');
  const target=legacyProductAliases[id]||'legacy-'+id;
  try{
    const product=await env.DB.prepare('SELECT id FROM mm_products WHERE id=? AND published=1 AND deleted=0').bind(target).first();
    if(!product)return unavailable(404,pendingIds.has(id)?'Soleo SonoStim 제품 안내':'제품 안내를 준비 중입니다',pendingIds.has(id)?'이 제품의 상세정보는 확인 중이며, 현재 공개된 상세페이지가 없습니다.':'이전 주소에 해당하는 제품은 현재 공개되어 있지 않습니다. 등록된 제품 목록에서 다른 장비를 확인해 주세요.');
    return new Response(null,{status:301,headers:{Location:'https://medicalmarket.co.kr/product?id=managed-'+target,'Cache-Control':'public, max-age=3600'}});
  }catch{
    return unavailable(503,'잠시 후 다시 확인해 주세요','제품 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
  }
}
