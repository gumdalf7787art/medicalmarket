const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=(value,max=3000)=>String(value??'').replace(/\r/g,'').trim().slice(0,max);
const won=value=>Number(value||0).toLocaleString('ko-KR')+'원';

// Money in a supplier reply is only a suggestion. The operator confirms VAT
// treatment and the resulting customer price before anything can be sent.
export function extractSupplierPrice(source){
 const text=clean(source,100000).replace(/[\u00a0\u200b]/g,' ');
 const vat=/부가세\s*(별도|제외)|VAT\s*(별도|excluded|excl)/i.test(text)?'exclusive':/부가세\s*(포함|포괄)|VAT\s*(포함|included|incl)/i.test(text)?'inclusive':'unknown';
 const lines=text.split(/\n|(?<=\.)\s+/).map(x=>x.trim()).filter(Boolean);
 const candidates=[];
 const amount=/(?:₩|￦|\bKRW\s*)?\s*(\d{1,3}(?:,\d{3})+|\d{4,12}|\d{1,4}(?:\.\d+)?)\s*(억원|억|천만원|백만원|만원|천원|원)?/gi;
 for(const [index,line] of lines.entries()){
  if(/전화|팩스|fax|사업자|등록번호|주소|관리번호|요청번호|날짜|연락처|휴대폰|\bREQ-/i.test(line))continue;
  for(const match of line.matchAll(amount)){
   const raw=Number(match[1].replaceAll(',',''));const unit=match[2]||'';
   const multiplier={억원:100000000,억:100000000,천만원:10000000,백만원:1000000,만원:10000,천원:1000,원:1}[unit]||1;
   const value=Math.round(raw*multiplier);
   if(value<1000||value>1000000000)continue;
   const context=line.slice(Math.max(0,match.index-32),Math.min(line.length,match.index+match[0].length+32));
   let score=(/공급\s*단가|제품\s*단가|판매\s*단가|단가|공급가/i.test(context)?6:0)+(/견적\s*금액|견적가|공급\s*금액|총액|합계/i.test(context)?3:0)+(unit?2:0)+(match[1].includes(',')?1:0)-(/배송|설치|운송|운임|할인|부가세\s*금액/i.test(context)?8:0);
   if(score<2)continue;
   candidates.push({value,score,excerpt:line.slice(0,240),line:index});
  }
 }
 candidates.sort((a,b)=>b.score-a.score||a.line-b.line);
 return {price:candidates[0]?.value||null,vat,evidence:candidates[0]?.excerpt||'',candidates:candidates.slice(0,6)};
}

export function quoteFromSources(request,replies=[],attachments=[]){
 const sources=[...attachments.map(x=>({type:'첨부파일',name:clean(x.name,180),text:clean(x.text,100000)})),...replies.map(x=>({type:'회신 본문',name:clean(x.subject,180),text:clean(x.body,100000)}))];
 const ranked=sources.map(source=>({...source,analysis:extractSupplierPrice(source.text)})).filter(x=>x.analysis.price).sort((a,b)=>b.analysis.candidates[0].score-a.analysis.candidates[0].score);
 const chosen=ranked[0],supplierUnit=chosen?.analysis.price||null;
 const vatStatus=chosen?.analysis.vat!=='unknown'?(chosen?.analysis.vat||'unknown'):(sources.map(x=>extractSupplierPrice(x.text).vat).find(x=>x!=='unknown')||'unknown');
 const supplierVatUnit=supplierUnit&&vatStatus!=='unknown'?Math.round(supplierUnit*(vatStatus==='exclusive'?1.1:1)):null;
 const customerUnit=supplierVatUnit?Math.round(supplierVatUnit*1.5):null;
 const p=request.product||{};
 return {itemName:clean(p.name,200),model:clean(p.model,150),qty:Number(request.qty)||1,supplierUnit,vatStatus,supplierVatUnit,customerUnit,amount:customerUnit?customerUnit*(Number(request.qty)||1):null,source:chosen?{type:chosen.type,name:chosen.name,evidence:chosen.analysis.evidence}:null,alternatives:ranked.slice(1,4).map(x=>({type:x.type,name:x.name,price:x.analysis.price,vatStatus:x.analysis.vat,evidence:x.analysis.evidence})),unreadable:attachments.filter(x=>x.error).map(x=>({name:clean(x.name,180),error:clean(x.error,200)}))};
}

export function normalizeCustomerQuote(request,input){
 const itemName=clean(input.itemName,200),model=clean(input.model,150),qty=Number(input.qty),unit=Number(input.unit);
 if(!itemName||!model||!Number.isSafeInteger(qty)||qty<1||qty>999||!Number.isSafeInteger(unit)||unit<1||unit>1000000000)throw Object.assign(new Error('품명·모델·수량·부가세 포함 단가를 확인해 주세요.'),{status:400});
 const total=unit*qty,tax=Math.round(total/11),net=total-tax;
 return {itemName,model,qty,unit,amount:total,net,tax,total,terms:clean(input.terms,3000),unitIncludesVat:true,supplierUnit:Number(input.supplierUnit)||null,supplierVatStatus:clean(input.supplierVatStatus,20)};
}

export function customerEmailSubject(request){return `[(주)피지오컴퍼니] ${clean(request.profile?.hospital,80)||'의료기기'} 견적서 안내`;}
export function renderCustomerQuoteEmail(request,quote,message){
 const hospital=escapeHtml(request.profile?.hospital||'고객'),body=escapeHtml(clean(message,2000)||'요청하신 의료기기 견적서를 보내드립니다. 첨부된 PDF를 확인해 주세요.').replace(/\n/g,'<br>');
 const field=(label,value)=>`<tr><th style="padding:12px 16px;text-align:left;background:#f5f8fc;border-bottom:1px solid #e4eaf2;width:100px">${label}</th><td style="padding:12px 16px;border-bottom:1px solid #e4eaf2">${escapeHtml(value)}</td></tr>`;
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><body style="margin:0;padding:24px;background:#f3f6fa;font-family:Arial,'Malgun Gothic',sans-serif;color:#21314b"><div style="max-width:680px;margin:auto;background:#fff;border:1px solid #e1e8f2;border-radius:14px;overflow:hidden"><div style="background:#18345e;color:#fff;padding:26px 32px"><div style="font-size:12px;letter-spacing:2px">PHYSIO COMPANY</div><div style="font-size:24px;font-weight:700;margin-top:8px">의료기기 견적서</div></div><div style="padding:28px 32px;line-height:1.8;font-size:15px"><p>${hospital} 담당자님, 안녕하세요.<br>(주)피지오컴퍼니입니다.</p><p>${body}</p><table role="presentation" style="border-collapse:collapse;width:100%;border:1px solid #e4eaf2">${field('품명',quote.itemName)}${field('모델',quote.model)}${field('수량',quote.qty+'대')}${field('견적총액',won(quote.total)+' (부가세 포함)')}</table><p style="font-size:13px;color:#65758d">견적서 PDF를 첨부했습니다. 상세 내역과 견적추가 사항은 첨부파일에서 확인해 주세요.</p><p>감사합니다.</p></div><div style="padding:22px 32px;background:#f6f8fc;font-size:13px;line-height:1.7;color:#455771"><strong>(주)피지오컴퍼니</strong><br>대표 : 최영호 · 사업자등록번호 : 736-81-01238<br>주소 : 서울특별시 송파구 마천로 30<br>대표번호 : 02-3472-4177 · Fax : 02-585-3083</div></div></body></html>`;
}

const bytes64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=12288)result+=btoa(String.fromCharCode(...bytes.subarray(i,i+12288)));return result;};
const lines=value=>value.match(/.{1,76}/g)?.join('\r\n')||'';
export async function sendCustomerQuoteEmail(access,recipient,subject,html,pdf){
 const encoder=new TextEncoder(),boundary='mm-'+crypto.randomUUID(),file='(주)피지오컴퍼니 견적서.pdf',encoded=encodeURIComponent(file);
 const mime=`From: =?UTF-8?B?${bytes64(encoder.encode('(주)피지오컴퍼니'))}?= <${access.email}>\r\nTo: ${recipient}\r\nSubject: =?UTF-8?B?${bytes64(encoder.encode(subject))}?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${lines(bytes64(encoder.encode(html)))}\r\n--${boundary}\r\nContent-Type: application/pdf; name*=UTF-8''${encoded}\r\nContent-Disposition: attachment; filename*=UTF-8''${encoded}\r\nContent-Transfer-Encoding: base64\r\n\r\n${lines(bytes64(pdf))}\r\n--${boundary}--`;
 const raw=bytes64(encoder.encode(mime)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+access.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Object.assign(new Error('Gmail이 고객 메일 발송을 거절했습니다. 계정 연결을 확인해 주세요.'),{status:502,definite:response.status>=400&&response.status<500});
 const sent=await response.json();if(!sent.id)throw Error('Gmail 발송 확인 ID가 없습니다.');return sent.id;
}
