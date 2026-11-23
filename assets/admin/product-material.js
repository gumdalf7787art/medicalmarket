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
