import {initialize,list,read,origin} from '../../server/guides.js';
import {guideProductLabel} from '../../shared/guide-product-label.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const picture=url=>new URL(url,origin+'/').href;
const style=`*{box-sizing:border-box}body{margin:0;color:#192b42;font:17px/1.8 system-ui,sans-serif}header,main{max-width:920px;margin:auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dde3ea}header img{width:138px;display:block}a{color:#174f88}h1{font-size:clamp(28px,5vw,44px);line-height:1.3}h2{font-size:24px}article{max-width:760px;margin:auto}article img{max-width:100%;max-height:540px;object-fit:contain}p{white-space:pre-line}small,time{color:#556675}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr));gap:20px;margin-block:24px}.card{border:1px solid #dde3ea;border-radius:12px;padding:18px;text-decoration:none}.card img{width:100%;height:180px;object-fit:contain}input,button,.cta{font:inherit;padding:8px 12px;border:1px solid #bccada;border-radius:6px}.cta,button{background:#174f88;color:white}.cta{display:inline-block;text-decoration:none;margin:20px 0}.guide-product-link{margin:28px 0 20px}.guide-product-link small{display:block;font-weight:700}.guide-product-link .cta{margin:6px 0 0;overflow-wrap:anywhere}nav a{margin-right:18px}`;
const indexStyle=`
.guide-index{background:#f5f5f7;color:#1d1d1f;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo",system-ui,sans-serif}
.guide-index header,.guide-index main{max-width:960px;padding-inline:24px}
.guide-index header{min-height:64px;padding-block:12px;border-color:#dedee3}
.guide-index header>a:last-child{font-size:13px;color:#424245;text-decoration:none}
.guide-index main{padding-block:34px 52px}
.guide-index .guide-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}
.guide-index h1{margin:0;font-size:clamp(27px,4vw,36px);letter-spacing:-.045em;line-height:1.2}
.guide-index form{display:flex;gap:7px;align-items:center}
.guide-index input{width:min(100%,220px);min-width:0;padding:7px 11px;border:1px solid #d2d2d7;border-radius:10px;background:#fff;color:inherit;font-size:13px}
.guide-index button{border:0;border-radius:10px;background:#0071e3;padding:8px 12px;font-size:13px;white-space:nowrap;cursor:pointer}
.guide-index a:focus-visible,.guide-index input:focus-visible,.guide-index button:focus-visible{outline:2px solid #0071e3;outline-offset:3px}
.guide-index .cards{grid-template-columns:repeat(4,minmax(0,1fr));align-items:stretch;gap:14px;margin:0}
.guide-index .card{display:flex;flex-direction:column;overflow:hidden;border:1px solid #e2e2e7;border-radius:16px;padding:0;background:#fff;color:inherit;box-shadow:0 2px 5px #00000006;transition:box-shadow .2s,transform .2s}
.guide-index .guide-cover{display:grid;place-items:center;aspect-ratio:2/1;min-width:0;overflow:hidden;background:linear-gradient(140deg,#f4f8fd,#e9eff7)}
.guide-index .guide-cover img{width:100%;height:100%;min-height:0;object-fit:contain;padding:8px;display:block}
.guide-index .guide-model-cover{padding:12px;text-align:center;font-size:clamp(15px,2.2vw,22px);font-weight:700;letter-spacing:-.03em;color:#253b59;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.guide-index .guide-copy{display:flex;flex-direction:column;gap:6px;padding:12px;flex:1}
.guide-index small{font-size:11px;line-height:1.35;font-weight:650;color:#365c86;overflow-wrap:anywhere}
.guide-index h2{margin:0;font-size:15px;line-height:1.4;letter-spacing:-.025em;overflow-wrap:anywhere}
.guide-index .guide-copy p{margin:0;font-size:12px;line-height:1.5;color:#515154;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.guide-index .guide-more{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:5px;color:#0066cc;font-size:12px;font-weight:600}
.guide-index .guide-empty{margin:0;padding:20px;border-radius:14px;background:#fff;color:#515154}
.guide-index .guide-pages{display:flex;gap:16px;margin-top:22px}
.guide-index .guide-pages a{margin:0;color:#0066cc}
@media(hover:hover){.guide-index .card:hover{transform:translateY(-2px);box-shadow:0 7px 20px #00000012}}
@media(max-width:760px){.guide-index .cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:560px){.guide-index header,.guide-index main{padding-inline:16px}.guide-index main{padding-block:23px 36px}.guide-index .guide-heading{align-items:stretch;flex-direction:column;gap:12px;margin-bottom:16px}.guide-index input{width:auto;flex:1}.guide-index .cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.guide-index .guide-copy{padding:10px}.guide-index h2{font-size:14px}}
@media(prefers-reduced-motion:reduce){.guide-index .card{transition:none}.guide-index .card:hover{transform:none}}
`;
function guideCard(guide){
  const image=JSON.parse(guide.images)[0],model=guide.model||guide.name;
  const cover=image
    ?'<img loading="lazy" decoding="async" src="'+esc(picture(image))+'" alt="">'
    :'<span class="guide-model-cover" aria-hidden="true">'+esc(model)+'</span>';
  return `<a class="card" href="/guide/${esc(guide.slug)}"><div class="guide-cover">${cover}</div><div class="guide-copy">${guide.model?'<small>'+esc(guide.model)+'</small>':''}<h2>${esc(guide.title)}</h2><p>${esc(guide.summary)}</p><span class="guide-more">글 보기 <span aria-hidden="true">→</span></span></div></a>`;
}
function page({title,summary,url,html,data,image,noindex,status=200,index=false}){
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | 메디컬마켓</title><meta name="description" content="${esc(summary)}"><link rel="canonical" href="${esc(url)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(summary)}"><meta property="og:url" content="${esc(url)}"><meta property="og:type" content="${data?'article':'website'}">${image?'<meta property="og:image" content="'+esc(image)+'">':''}${noindex?'<meta name="robots" content="noindex,follow">':''}${data?'<script type="application/ld+json">'+JSON.stringify(data).replace(/</g,'\\u003c')+'</script>':''}<style>${style}${index?indexStyle:''}</style></head><body${index?' class="guide-index"':''}><header><a href="/"><img src="/assets/brand/medicalmarket-logo.png" alt="메디컬마켓"></a><a href="/guide">제품 안내</a></header><main>${html}</main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
export async function onRequestGet({request,env,params}){
  await initialize(env.DB);
  const parts=params.slug||[],slug=parts[0],base=origin+'/guide';
  if(slug){
    const g=parts.length===1&&await read(env.DB,slug);
    if(!g)return page({title:'글을 찾을 수 없습니다',html:'<h1>글을 찾을 수 없습니다</h1><a href="/guide">제품 안내 목록</a>',status:404,noindex:true,url:base});
    const images=JSON.parse(g.images).map(picture),url=base+'/'+slug,org={'@type':'Organization',name:'메디컬마켓',url:origin};
    const photo=i=>images[i]?'<figure><img src="'+esc(images[i])+'" alt="'+esc(g.name+' '+(g.model||'')+' 사진 '+(i+1))+'"></figure>':'';
    const body=g.body.split(/\n\s*\n/).map(block=>block.startsWith('## ')?'<h2>'+esc(block.slice(3))+'</h2>':'<p>'+esc(block)+'</p>').join('');
    return page({title:g.title,summary:g.summary,url,image:images[0],data:{'@context':'https://schema.org','@type':'BlogPosting',headline:g.title,description:g.summary,datePublished:g.first_published,dateModified:g.updated,mainEntityOfPage:url,author:org,publisher:org,image:images,about:{'@type':'Product',name:g.name,model:g.model}},html:`<article><nav><a href="/guide">제품 안내 목록</a></nav><h1>${esc(g.title)}</h1><small>메디컬마켓 · <time datetime="${esc(g.updated)}">${esc(g.updated.slice(0,10))}</time></small><p>${esc(g.summary)}</p><p><strong>${esc(g.name)} ${esc(g.model)}</strong></p>${photo(0)}${body}${images.slice(1).map((_,i)=>photo(i+1)).join('')}<div class="guide-product-link"><small>메디컬마켓</small><a class="cta" href="/product.html?id=${encodeURIComponent('managed-'+g.product_id)}">${esc(guideProductLabel(g.product_id,g.name))} 자세히 보러 가기 (견적 요청 가능)</a></div></article>`});
  }
  const query=new URL(request.url).searchParams,q=(query.get('q')||'').trim().slice(0,100),n=Math.min(100000,Math.max(1,parseInt(query.get('page'))||1));
  const rows=await list(env.DB,q,n),link=i=>base+'?'+new URLSearchParams({...q&&{q},page:String(i)});
  const cards=rows.slice(0,20).map(guideCard).join('');
  const pages=(n>1?'<a rel="prev" href="'+esc(link(n-1))+'">이전</a>':'')+
    (rows.length>20?'<a rel="next" href="'+esc(link(n+1))+'">다음</a>':'');
  return page({title:'제품 안내',summary:'메디컬마켓에 등록된 의료장비의 제품 안내를 장비명과 모델명으로 찾아보세요.',url:n===1?base:link(n),noindex:!!q,index:true,html:`
    <div class="guide-heading"><h1>제품 안내</h1><form action="/guide" role="search"><input type="search" aria-label="장비명 또는 모델명" name="q" maxlength="100" placeholder="장비명 또는 모델명" value="${esc(q)}"><button>검색</button></form></div>
    ${cards?'<div class="cards">'+cards+'</div>':'<p class="guide-empty">'+(q?'검색 결과가 없습니다.':'등록된 제품 안내 글이 없습니다.')+'</p>'}
    ${pages?'<nav class="guide-pages" aria-label="목록 페이지">'+pages+'</nav>':''}
  `});
}
