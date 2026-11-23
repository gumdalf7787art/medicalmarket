import {inbodyCatalog} from './inbody-catalog-data.js';

const escapeHtml=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const textBytes=new TextEncoder();

async function photoPath(address){
  const digest=await crypto.subtle.digest('SHA-256',textBytes.encode(address));
  const key=Array.from(new Uint8Array(digest).slice(0,16),byte=>byte.toString(16).padStart(2,'0')).join('');
  return 'assets/products/inbody-series/'+key+'.webp';
}

export async function prepareInbodyProduct(product){
  if(product.maker!=='인바디'||!Object.hasOwn(inbodyCatalog,product.model))return product;
  const entry=inbodyCatalog[product.model];
  const saved=await Promise.all(entry.images.map(async ([address,label])=>({address,label,path:await photoPath(address)})));
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
