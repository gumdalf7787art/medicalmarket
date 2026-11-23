import {failure,limitedBody} from './cloud.js';
import {inbodyCatalog} from './inbody-catalog-data.js';

const escapeHtml=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const textBytes=new TextEncoder();

async function saveOfficialImage(bucket,address){
  const url=new URL(address);
  const webp=url.origin==='https://inbody.com' && /^\/images\/products\/category\/body_composition\/inbody[a-z0-9]+\/[a-z0-9_]+\.webp$/.test(url.pathname);
  const png=url.origin==='https://inbodyinfra.blob.core.windows.net' && /^\/inbodyhome\/prod\/product\/[^/]+\.png$/.test(url.pathname);
  if(!webp&&!png)throw failure('인바디 공식 사진 주소를 확인해 주세요.',422);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',textBytes.encode(address))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const id=hash.slice(0,32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');
  const extension=webp?'webp':'png';
  const name=id+'.'+extension;
  const key='product-images/'+name;
  if(!await bucket.head(key)){
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw failure('인바디 공식 이미지 응답을 확인해 주세요.',502);
    const bytes=await limitedBody(response,8*1024*1024);
    const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
    const valid=webp
      ?ascii(0,4)==='RIFF' && ascii(8,12)==='WEBP'
      :[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte);
    if(!valid)throw failure('공식 이미지 파일 형식을 확인해 주세요.',502);
    await bucket.put(key,bytes,{httpMetadata:{contentType:'image/'+extension}});
  }
  return '/media/'+name;
}

export async function prepareInbodyProduct(env,product){
  if(product.maker!=='인바디'||!Object.hasOwn(inbodyCatalog,product.model))return product;
  if(!env.MEDIA)throw failure('제품 사진 저장소 연결을 확인해 주세요.',503);
  const entry=inbodyCatalog[product.model];
  const saved=[];
  for(let index=0;index<entry.images.length;index+=5){
    const images=await Promise.all(entry.images.slice(index,index+5).map(async ([address,label])=>{
      try {
        return {address,label,path:await saveOfficialImage(env.MEDIA,address)};
      } catch(error){
        throw failure(product.model+' '+label+' 사진 저장 실패 · '+(error.status?error.message:'원본 서버 접속 오류'),502);
      }
    }));
    saved.push(...images);
  }
  const figure=pattern=>{
    const item=saved.find(x=>x.address.includes(pattern));
    return item?`<figure><img src="${item.path}" alt="${escapeHtml(product.model+' '+item.label)}" loading="lazy"><figcaption>${escapeHtml(item.label)}</figcaption></figure>`:'';
  };
  const specRows=Object.entries(entry.spec).map(([label,value])=>`<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('');
  const options=entry.options.length?` 제품 안내의 선택품은 ${escapeHtml(entry.options.join(', '))}입니다.`:'';
  const descriptionHtml=`<h3>${escapeHtml(entry.heading)}</h3><p>${escapeHtml(entry.intro)}</p>${figure('_product_info_01')}
    <h3>결과지와 상담</h3><p>${escapeHtml(entry.report)}</p>${figure('_result_paper_01')}
    <h3>주요 사양</h3><table><tbody>${specRows}</tbody></table>
    <h3>구성과 견적 확인</h3><p>기본 구성은 ${escapeHtml(entry.components.join(', '))}입니다.${options} 프린터와 전용 결과지, 데이터 관리 프로그램이 필요한 경우 견적에 포함되는 항목을 확인하세요.</p>`;
  return {...product,image:saved[0].path,gallery:saved.map(item=>item.path),descriptionHtml};
}
