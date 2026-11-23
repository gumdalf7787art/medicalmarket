// Editorial update for the existing public J50 record. The revision guard preserves later admin edits.
export const j50Id='discovered-cd606f14-a1c4-4c7c-af29-d3954d0776a0';
const root='assets/products/inbody-j50/';
const illustrations={
  front:'제품 정면', product_bg:'J50 제품 전경', product_info_01:'신장 측정부와 전극 등 본체 각부 명칭',
  design_01:'신장계 일체형 구조', design_02:'접이식 구조와 이동 바퀴', design_03:'키패드와 컬러 LCD',
  tech_01:'다주파수 측정',tech_02:'부위별 분석',tech_03:'소아·청소년 결과',tech_04:'외부 장비 연동',
  result_paper_01:'체성분 결과지 예시',result_paper_02:'소아·청소년용 결과지 예시',dimensions:'제품 사양 이미지',
  product_component_basic_01:'본체',product_component_basic_02:'전원 어댑터와 케이블',
  product_component_result_01:'프린터',product_component_result_02:'프린터 데스크',product_component_result_03:'전용 결과지',
  spec_01:'키와 체성분 측정 아이콘',spec_02:'성장 지표 아이콘',spec_03:'결과지 아이콘',logo:'InBody J50 모델 로고'
};
const file=key=>root+key+'.webp';
const figure=key=>`<figure><img src="${file(key)}" alt="InBody J50 · ${illustrations[key]}" loading="lazy" style="max-width:100%;height:auto"><figcaption>${illustrations[key]}</figcaption></figure>`;
const specs=[
  ['측정 방식','손·발의 8개 접점으로 부위별 생체전기 임피던스를 측정합니다.'],
  ['주파수와 측정 부위','5, 50, 250 kHz를 양팔·몸통·양다리에 각각 적용해 총 15개 값을 얻습니다.'],
  ['체중 측정 범위','0~250 kg'],['화면','3.5인치 컬러 LCD · 320 × 240'],
  ['본체 크기','가로 396 × 깊이 665 × 높이 1,351 mm'],['본체 무게','24 kg']
];
const description=`<h3>키와 체성분을 함께 기록하는 성장기용 장비</h3>
<p>InBody J50은 신장계와 체성분분석기를 한 본체에 담았습니다. 아이가 발판에 서면 신장 측정부의 터치바로 키를 재고, 손과 발의 전극으로 체성분을 측정합니다. 키를 잰 뒤 다른 검사대로 이동할 필요가 없어 소아 진료실이나 학교 검진에서 측정 동선을 짧게 구성할 수 있습니다.</p>
${figure('product_info_01')}
<h3>검사 후 어떤 내용을 설명할 수 있나요?</h3>
<p>일반 체성분 결과지에서는 골격근량과 체지방, 부위별 근육 및 체지방 분포를 살펴볼 수 있습니다. 보호자와 성장 상태를 이야기할 때는 소아·청소년용 결과지에서 연령별 키와 체중의 위치를 먼저 확인하고, 근육량·체지방량과 소아비만도 항목을 함께 볼 수 있습니다.</p>
${figure('result_paper_02')}
<h3>설치 공간과 검진 동선</h3>
<p>장비를 둘 때는 본체 크기에 더해 아이가 발판에 오르내릴 공간과 검사자가 키패드를 조작할 자리를 확보하세요. 여러 방에서 사용할 계획이라면 접이식 구조와 바퀴가 이동 경로에 맞는지, 이동 뒤 발판의 수평을 맞출 수 있는지 확인하면 좋습니다.</p>
${figure('design_02')}
<h3>주요 사양</h3><table><tbody>${specs.map(([label,value])=>`<tr><th>${label}</th><td>${value}</td></tr>`).join('')}</tbody></table>
<h3>도입 전 확인할 구성품</h3><p>제조사가 안내하는 기본 구성은 본체와 전원 어댑터·케이블입니다. 종이 결과지를 사용할 기관은 견적에서 프린터, 프린터 데스크, 결과지의 포함 여부를 확인하세요. 회원관리 프로그램 LookinBody(LB Web·LB120)는 별도 구매 항목입니다. 인바디 혈압계를 함께 사용할 때는 보유 모델의 연결 가능 여부도 확인하세요.</p>
<p>이 제품은 의료기기입니다. 사용 전 제품 설명서의 사용 방법과 주의사항을 확인하세요.</p>`;
export async function updateJ50(db,row){
  const p=JSON.parse(row.payload);
  if(p.id!==j50Id || p.model!=='InBody J50')return row;
  const footer='<p>사양과 이미지 출처 · <a href="https://inbody.com/kr/ko/products/category/body-composition/1">인바디 공식 InBody J50 제품 안내</a></p>';
  const seed=row.revision===1 && !p.descriptionHtml?.trim();
  if(!seed && !p.descriptionHtml?.includes(footer))return row;
  const at=new Date().toISOString(),gallery=Object.keys(illustrations).map(file);
  const payload=JSON.stringify(seed?{...p,image:gallery[0],gallery,descriptionHtml:description,updatedAt:at}:{...p,descriptionHtml:p.descriptionHtml.replace(footer,''),updatedAt:at});
  const result=await db.prepare('UPDATE mm_products SET payload=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND published=1 AND deleted=0').bind(payload,at,j50Id,row.revision).run();
  if(result.meta.changes===1)return {payload,revision:row.revision+1};
  return null;
}
