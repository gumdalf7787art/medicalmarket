import React,{useState,useEffect} from 'react';
import {guideProductLabel} from '../shared/guide-product-label.js';
import './guide-editor.css';
const empty={slug:'',productId:'',title:'',summary:'',body:'',images:[],revision:0,published:false};
async function api(url,options){
  const res=await fetch(url,options),data=await res.json();
  if(!res.ok)throw Error(data.error||'요청을 처리하지 못했습니다.');
  return data;
}
export default function GuideEditor(){
  const [form,set]=useState(empty),[product,productSet]=useState(null),[q,search]=useState(''),[products,results]=useState([]),[rows,rowsSet]=useState([]),[page,paging]=useState(1),[more,moreSet]=useState(false),[version,refresh]=useState(0),[busy,lock]=useState(false),[message,tell]=useState('');
  const patch=values=>set(old=>({...old,...values}));
  useEffect(()=>{
    let live=true;
    api('/api/guides?admin=1&page='+page).then(data=>{if(live){rowsSet(data.guides);moreSet(data.more);}}).catch(e=>{if(live)tell(e.message);});
    return ()=>{live=false;};
  },[page,version]);
  useEffect(()=>{
    let live=true;
    const timer=setTimeout(()=>api('/api/cloud/products?page=1&q='+encodeURIComponent(q)).then(data=>{if(live)results(data.products);}).catch(e=>{if(live)tell(e.message);}),250);
    return ()=>{live=false;clearTimeout(timer);};
  },[q]);
  async function run(fn){lock(true);tell('');try{await fn();}catch(e){tell(e.message);}finally{lock(false);}}
  const getProduct=async id=>(await api('/api/cloud/products?id='+encodeURIComponent(id))).product;
  function edit(slug){run(async()=>{
    const g=await api('/api/guides/'+slug+'?admin=1'),p=await getProduct(g.product_id);
    set({...g,productId:p.id,published:!!g.published});productSet(p);
  });}
  function choose(id){if(id)run(async()=>{
    const p=await getProduct(id);productSet(p);patch({productId:id,images:p.image?[p.image]:[],title:form.title||[p.name,p.model].filter(Boolean).join(' ')+' 제품 안내',slug:form.slug||'guide-'+crypto.randomUUID()});
  });}
  function store(published){run(async()=>{
    const g=await api('/api/guides/'+encodeURIComponent(form.slug),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,published})});
    patch({revision:g.revision,published});refresh(v=>v+1);tell(published?'발행했습니다.':'비공개로 저장했습니다.');
  });}
  const photos=product?.guidePhotos?product.guidePhotos.gallery:[...new Set([product?.image,...(product?.gallery||[])].filter(Boolean))];
  return <section className="guide-editor"><h1>제품 안내 관리</h1><fieldset disabled={busy}><legend>작성한 글</legend>
    {rows.map(r=><button key={r.slug} onClick={()=>edit(r.slug)}>{r.published?'공개':'비공개'} · {r.title}</button>)}
    {page>1&&<button onClick={()=>paging(page-1)}>이전</button>}{more&&<button onClick={()=>paging(page+1)}>다음</button>}
    <button onClick={()=>{set(empty);productSet(null);tell('');}}>새 글 작성</button></fieldset>
    <fieldset disabled={busy}><legend>제품과 사진</legend><label>제품명 또는 모델명 검색<input value={q} onChange={e=>search(e.target.value)}/></label><label>등록 제품 선택<select value={form.productId} onChange={e=>choose(e.target.value)}><option value="">선택하세요</option>{product&&!products.some(p=>p.id===product.id)&&<option value={product.id}>{product.name} {product.model}</option>}{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>
    {photos.length>0&&<p>사진을 2~4장 선택하면 클릭한 순서로 표시합니다. 첫 사진은 대표 이미지입니다. 선택이 2장 미만이면 갤러리 사진을 자동으로 보완합니다.</p>}
    <div className="guide-photos">{photos.map(url=><label key={url}><img src={url} alt={product.name}/><span><input type="checkbox" checked={form.images.includes(url)} disabled={form.images.length>=4&&!form.images.includes(url)} onChange={()=>patch({images:form.images.includes(url)?form.images.filter(x=>x!==url):[...form.images,url]})}/> {form.images.includes(url)?form.images.indexOf(url)+1:'선택'}</span></label>)}</div></fieldset>
    <fieldset disabled={busy}><legend>글 편집</legend><label>글 주소 (/guide/ 뒤에 표시)<input value={form.slug} disabled={form.revision>0} onChange={e=>patch({slug:e.target.value})}/></label>
    <label>제목<input maxLength={200} value={form.title} onChange={e=>patch({title:e.target.value})}/></label><label>요약<textarea maxLength={500} value={form.summary} onChange={e=>patch({summary:e.target.value})}/></label>
    <label>본문 (빈 줄로 문단 구분, 소제목은 ## 으로 시작)<textarea rows="14" maxLength={60000} value={form.body} onChange={e=>patch({body:e.target.value})}/></label>
    <details><summary>글 미리보기</summary><article><h2>{form.title}</h2><p>{form.summary}</p><strong>{product?.name} {product?.model}</strong>
      {form.images[0]&&<img src={form.images[0]} alt={product?.name}/>}
      {form.body.split(/\n\s*\n/).map((part,i)=>part.startsWith('## ')?<h3 key={i}>{part.slice(3)}</h3>:<p key={i}>{part}</p>)}
      {form.images.slice(1).map(url=><img key={url} src={url} alt={product?.name}/>)}
      {product&&<div><div><small>메디컬마켓</small></div><a href={'/product.html?id='+encodeURIComponent('managed-'+product.id)} target="_blank" rel="noreferrer">{guideProductLabel(product.id,product.name)} 자세히 보러 가기 (견적 요청 가능)</a></div>}
    </article></details>
    <button onClick={()=>store(false)}>{form.published?'비공개 전환':'초안 저장'}</button><button onClick={()=>store(true)}>발행 저장</button>{form.revision>0&&form.published&&<a href={'/guide/'+form.slug}>공개 글 보기</a>}</fieldset><p role="status">{message}</p></section>;
}
