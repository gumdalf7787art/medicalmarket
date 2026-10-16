const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=(value,max)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
export const certificateKey='supplier-mail/physiocompany-business-registration.jpg';
export const certificateName='(주)피지오컴퍼니 사업자등록증.jpg';
export function defaultSupplierDraft(row){
 const p=row.payload.product||{},profile=row.payload.profile||{};
 return {subject:`[(주)피지오컴퍼니] ${p.name||'의료기기'} 공급 단가 문의`,
  greeting:'안녕하세요. (주)피지오컴퍼니입니다.',
  introduction:'아래 제품의 공급 단가를 문의드립니다.',
  product:p.name||'의료기기',model:p.model||'미등록',quantity:`${Number(row.payload.qty)||1}대`,
  hospital:profile.hospital||'미등록',region:[profile.province,profile.district].filter(Boolean).join(' ')||'미등록',
  request:'공급 단가(부가세 별도)를 알려주시면 감사하겠습니다.\n혹시 추가로 배송비, 설치비, 예상 공급일정 등 추가 사항이 있으면 코멘트 달아주십시오.'};
}
export function normalizeSupplierDraft(row,input={}){
 const defaults=defaultSupplierDraft(row),draft={};
 for(const [key,value] of Object.entries(defaults))draft[key]=key==='request'?String(input[key]===undefined?value:input[key]).replace(/\r\n?/g,'\n').trim().slice(0,2000):clean(input[key]===undefined?value:input[key],key==='subject'?160:250);
 if(!draft.subject||!draft.product||!draft.quantity||!draft.request)throw Object.assign(new Error('제목, 제품, 수량과 요청 내용을 입력해 주세요.'),{status:400});
 return draft;
}
export function renderSupplierMail(row,draft){
 const field=(label,value)=>`<tr><th style="padding:12px 16px;text-align:left;vertical-align:top;width:105px;color:#65758d;background:#f5f8fc;border-bottom:1px solid #e5ebf3;font-weight:600">${escapeHtml(label)}</th><td style="padding:12px 16px;color:#20314e;border-bottom:1px solid #e5ebf3">${escapeHtml(value)}</td></tr>`;
 const paragraphs=value=>escapeHtml(value).replace(/\n/g,'<br>');
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><body style="margin:0;padding:24px;background:#f2f5f9;font-family:Arial,'Malgun Gothic',sans-serif;color:#23314b"><div style="max-width:680px;margin:auto;background:#fff;border:1px solid #e1e7f0;border-radius:16px;overflow:hidden"><div style="background:#18345e;color:#fff;padding:27px 32px"><div style="font-size:12px;letter-spacing:2px;opacity:.8">PHYSIO COMPANY</div><div style="font-size:24px;font-weight:700;margin-top:8px">공급 단가 문의</div></div><div style="padding:30px 32px;font-size:15px;line-height:1.8"><p style="margin:0 0 14px">${paragraphs(draft.greeting)}</p><p style="margin:0 0 24px">${paragraphs(draft.introduction)}</p><table role="presentation" style="border-collapse:collapse;width:100%;border:1px solid #e5ebf3">${field('제품',draft.product)}${field('모델',draft.model)}${field('수량',draft.quantity)}${field('병원명',draft.hospital)}${field('납품지역',draft.region)}${field('관리번호',row.id)}</table><p style="margin:8px 0 24px;color:#7b8798;font-size:12px">(관리번호는 내부 관리용입니다.)</p><p style="margin:0 0 27px">${paragraphs(draft.request)}</p><p style="margin:0">감사합니다.</p></div><div style="padding:24px 32px;background:#f6f8fc;border-top:1px solid #e5ebf3;font-size:13px;line-height:1.8;color:#455771"><strong style="display:block;color:#1e3353;font-size:16px">(주)피지오컴퍼니</strong>대표 : 최영호<br>사업자등록번호 : 736-81-01238<br>주소 : 서울특별시 송파구 마천로 30<br>대표번호 : 02-3472-4177<br>Fax : 02-585-3083</div></div></body></html>`;
}
