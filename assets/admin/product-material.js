const discovery='/api/discovery';
const progress=document.querySelector('#progress');
const save=document.querySelector('#save');
async function api(url,options={}) {
  const response=await fetch(url,{cache:'no-store',...options});
  const result=await response.json();
  if(!response.ok) throw Error(result.error||('HTTP '+response.status));
  return result;
}
async function list(){
  const {rows}=await api(discovery);
  const ul=document.querySelector('#saved');
  ul.replaceChildren();
  for(const row of rows.filter(row=>row.materialCount && !row.decision)){
    const li=document.createElement('li');
    const details=document.createElement('details');
    const summary=document.createElement('summary');
    summary.textContent=row.model+' · 비공개 · 사진 '+row.materialCount+'장 · 상세 설명 저장됨';
    details.append(summary);
    details.ontoggle=async()=>{
      if(!details.open||details.childElementCount>1)return;
      const body=document.createElement('div');
      details.append(body);
      try{
        const query=new URLSearchParams({supplier:row.supplier_id,material:row.identity});
        const {material}=await api(discovery+'?'+query);
        const parsed=new DOMParser().parseFromString(material.descriptionHtml,'text/html');
        for(const p of parsed.querySelectorAll('p')){
          const text=document.createElement('p');text.textContent=p.textContent;body.append(text);
        }
        for(const [index,url] of material.gallery.entries()){
          const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';
          const img=document.createElement('img');img.src=url+'?thumb=1';img.loading='lazy';img.width=100;img.alt=index===0?'대표 사진':row.model+' 사진 '+(index+1);link.append(img);body.append(link);
        }
      }catch(e){body.textContent=e.message;}
    };
    li.append(details);
    ul.append(li);
  }
  return rows;
}
function bytes(text) {return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
async function image(file){
  const body=bytes(file.webp);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),n=>n.toString(16).padStart(2,'0')).join('');
  const upload=(data,header)=>api('/api/cloud/image',{method:'POST',headers:{'Content-Type':'image/webp',...header},body:data});
  const {url}=await upload(body,{'X-Image-SHA256':hash});
  await upload(bytes(file.thumb),{'X-Thumbnail-For':url.split('/').pop()});
  return url;
}
async function prepare(file,rows){
  const d=JSON.parse(await file.text());
  const matches=rows.filter(r=>!r.decision && r.kind==='draft' && r.maker===d.maker && r.model===d.model && r.source_url===d.source);
  if(matches.length!==1) throw Error(d.model+' · 일치하는 비공개 초안 1건이 필요합니다.');
  if(!Array.isArray(d.images)||!d.images.length||d.images.length>20||!d.paragraphs?.length)throw Error('본문과 제품 사진 수(1~20장)를 확인하세요.');
  const gallery=[];
  for(let start=0;start<d.images.length;start+=4){
    progress.textContent=d.model+' · 사진 '+Math.min(start+4,d.images.length)+' / '+d.images.length;
    gallery.push(...await Promise.all(d.images.slice(start,start+4).map(image)));
  }
  const row=matches[0];
  await api(discovery,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare',supplier:row.supplier_id,identity:row.identity,gallery,paragraphs:d.paragraphs,figures:d.figures})});
}
save.onclick=async()=>{
  save.disabled=true;
  const failures=[];
  try{
    const rows=await list();
    const files=Array.from(document.querySelector('#files').files);
    if(!files.length)throw Error('제품 자료 파일을 선택하세요.');
    for(const file of files){
      try {await prepare(file,rows);await list();}
      catch(e){failures.push(file.name+' · '+e.message);}
    }
    progress.textContent=files.length+'건 중 '+(files.length-failures.length)+'건 비공개 저장 완료'+(failures.length?'\n'+failures.join('\n'):'');
  }catch(e){progress.textContent=e.message;}finally{save.disabled=false;}
};
list().catch(e=>{progress.textContent=e.message;});

// Full licensed descriptions keep inline photos separate from the curated card gallery.
const detailStatus=document.querySelector('#detail-status');
const detailButton=document.querySelector('#update-details');
async function updateDetail(file){
  const d=JSON.parse(await file.text());
  if(typeof d.html!=='string'||!Array.isArray(d.images)||!d.images.length)throw Error('본문과 사진을 확인하세요.');
  const parse=html=>new DOMParser().parseFromString(html,'text/html').body;
  const body=parse(d.html);
  const photos=Array.from(body.querySelectorAll('img'));
  const indices=photos.map(img=>{
    const match=/^MMIMAGE(\d+)END$/.exec(img.getAttribute('src'));
    if(!match||Number(match[1])>=d.images.length)throw Error('본문 이미지 번호를 확인하세요.');
    return Number(match[1]);
  });
  if(new Set(indices).size!==d.images.length||!body.textContent.trim())throw Error('본문에 연결된 사진과 설명을 확인하세요.');
  const url='/api/cloud/products';
  const query='?id='+encodeURIComponent(d.id);
  const {product}=await api(url+query+'&admin=1');
  if(!product.published||product.deleted||product.model!==d.model||product.maker!==d.maker)throw Error('공개 제품의 모델과 제조사가 일치해야 합니다.');
  const media=[];
  for(let i=0;i<d.images.length;i+=6){
    detailStatus.textContent=d.model+' · 본문 사진 저장 '+i+' / '+d.images.length;
    media.push(...await Promise.all(d.images.slice(i,i+6).map(image)));
  }
  photos.forEach((img,i)=>img.setAttribute('src',media[indices[i]]));
  const saved=await api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...product,descriptionHtml:body.innerHTML})});
  const {product:live}=await api(url+query);
  if(live.revision!==saved.product.revision||!live.published||live.descriptionHtml!==saved.product.descriptionHtml)throw Error('공개본을 확인하세요.');
  const rendered=parse(live.descriptionHtml);
  const actual=Array.from(rendered.querySelectorAll('img'),el=>el.getAttribute('src'));
  if(JSON.stringify(actual)!==JSON.stringify(indices.map(n=>media[n]))||rendered.textContent.trim()!==body.textContent.trim())throw Error('저장된 본문 또는 사진을 확인하세요.');
  return d.model+' · 본문 사진 '+actual.length+'개 공개 확인';
}
detailButton.onclick=async()=>{
  const files=Array.from(document.querySelector('#detail-files').files);
  if(!files.length){detailStatus.textContent='상세 원문 파일을 선택하세요.';return;}
  detailButton.disabled=true;
  const results=[];
  try{
    for(const file of files){
      try{results.push(await updateDetail(file));}
      catch(error){results.push(file.name+' · '+error.message);}
    }
  }finally{detailButton.disabled=false;detailStatus.textContent=results.join('\n');}
};
