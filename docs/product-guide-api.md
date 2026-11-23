# 제품 안내 발행 API

## 관리자 화면에서 발행 도구 연결

운영 API에 접속할 수 있는 Windows 실행 환경에서 `scripts/guide-publish.ps1 -Action pair`를 실행한다. 도구가 만든 토큰은 같은 Windows 계정에서만 읽을 수 있도록 암호화해 저장한다. 서버에는 토큰 해시만 보내며, 도구가 출력한 연결 ID를 확인한다.

메디컬마켓 운영 화면의 **제품 안내 관리 → 브라우저 없는 제품 안내 API 연결**에서 같은 ID를 입력하고 승인한다. 연결 요청은 30분 안에 승인한다. 승인된 연결은 관리자가 해제할 때까지 유지된다. 승인 후 `scripts/guide-publish.ps1 -Action connection-status`의 `active`를 확인한다. 발행할 때는 `-UsePairedConnection`을 추가한다. 연결 목록에서 연결을 해제하면 해당 연결은 즉시 인증에 실패한다. 이 연결의 권한은 제품 안내 조회·초안 저장·공개에 한정된다.

자동 작성 도구는 https://medicalmarket.co.kr 의 API에서 초안 저장과 공개 발행을 처리합니다. 자동 작성 도구는 Cloudflare Pages Production의 Secret GUIDE_PUBLISH_TOKEN에 설정한 길고 무작위인 전용 값을 서버 측 Authorization: Bearer 헤더로 전달합니다. Secret 설정 후 재배포합니다. 실행 환경에도 동일한 전용 토큰을 GUIDE_PUBLISH_TOKEN으로 안전하게 연결합니다. 운영자 비밀번호나 Gmail 자격 증명을 공유하지 않습니다.

1. GET /api/cloud/products?page=1&q=검색어 로 공개 제품을 찾고 GET /api/cloud/products?id=제품번호 에서 image, gallery, guidePhotos.details를 확인합니다.
2. PUT /api/guides/{slug} 에 Content-Type: application/json 으로 아래 구조를 보냅니다. slug는 영문 소문자·숫자·하이픈 1~120자이며 최초 저장 후 같은 주소로 수정합니다.

```json
{"productId":"등록된 제품 ID","title":"글 제목","summary":"핵심 답변을 담은 소개","body":"첫 문단\n\n## 소제목\n\n설명","images":[],"published":false,"revision":0}
```

images에는 선택한 제품 갤러리의 이미지 URL을 2~4장 넣습니다. 2장 미만으로 지정된 글은 갤러리 사진으로 보완합니다. 상세 설명에서 가져올 부분은 잘라 별도 이미지로 저장한 뒤 같은 제품의 갤러리에 등록합니다. guidePhotos.details에만 있는 상세 설명 원본은 참고용입니다. 첫 사진은 대표 이미지입니다. 본문은 일반 텍스트이고 빈 줄로 문단을 구분합니다. 제목은 200자, 요약은 500자, 본문은 60,000자 이내입니다. 제목과 주제는 모델명으로 제한하지 않습니다.

3. 저장 결과의 revision을 사용해 같은 주소에 전체 문서를 PUT합니다. 공개할 때 published를 true로 설정합니다. false로 저장하면 초안 또는 비공개 전환입니다. 409 충돌 시 GET /api/guides/{slug}?admin=1 로 최신 버전을 확인하고 변경 내용을 비교한 뒤 다시 저장합니다. 읽기 응답의 product_id는 쓰기 요청의 productId에 대응합니다. 초안 조회도 같은 인증이 필요합니다.
4. GET /api/guides?q=검색어&page=1 과 /guide/{slug} 에서 공개 결과를 확인합니다. 하단 견적 요청하기 링크에 연결된 제품도 확인합니다. API에 없는 이미지 URL이나 비공개 제품은 발행에 사용할 수 없습니다. 제품을 숨기면 연결된 글도 공개 검색과 사이트맵에서 제외됩니다.
