# 브라우저 없는 제품 수집 및 공개

프로젝트 루트에서 Node 프로젝트 의존성(`npm ci`)과 Python Pillow(`python -m pip install Pillow`)를 설치한다. 메디컬마켓 관리자 이메일과 비밀번호는 실행 환경의 `MM_PRODUCT_EMAIL`, `MM_PRODUCT_PASSWORD`에 공급한다. 명령행 인수, JSON, 저장소에 비밀번호를 기록하지 않는다. CLI는 매 실행 시 운영 로그인 API로 인증한다. 블로그 토큰은 제품 권한으로 사용할 수 없다.

1. `python scripts/product-pipeline.py scan inbody`로 공식 목록을 HTTP로 수집한다. 지원 키는 `inbody`, `alpinion`, `bistos0340`이다. `list`로 공급업체 ID, identity, 매칭 상태, 추천 카테고리를 조회한다.
2. `python scripts/product-pipeline.py collect KEY SUPPLIER IDENTITY review.json`으로 공식 상세 페이지의 본문, 사양표, 이미지 후보를 추출한다. 필요한 경우 `--selector "제품영역 CSS 선택자"`를 추가한다. 모델 공용 페이지에서는 해당 모델의 사양과 이미지를 선별한다. HTML에 없는 자료는 제조사의 공식 데이터 응답에서 확인한 뒤 검토 파일에 보충한다. 수집에 실패하거나 자료가 빠지면 공개를 보류한다.
3. 검토 파일에서 paragraphs를 사실에 근거한 구매자용 설명으로 편집하고 category를 확인한다. images에는 본체 전경을 첫 번째로 둔다. 대표 사진을 포함해 제품당 최대 20장을 선정한다. 본체 전경, 조작부, 주요 구성품과 핵심 기능을 우선하고 비슷한 각도와 반복되는 검사 화면은 제외한다. 긴 이미지의 특정 영역은 이미지 항목에 `"crop": [left, top, right, bottom]`을 픽셀로 지정한다. 같은 원본을 다른 좌표로 여러 번 사용할 수 있다. 제조사 URL은 내부 수집 기록에만 둔다.
4. `python scripts/product-pipeline.py prepare review.json`으로 원본을 다운로드·크롭하고 WebP 원본 및 썸네일을 메디컬마켓 이미지 API에 저장한다. 같은 결과 파일은 해시로 재사용한다. 새 제품의 본문과 사진은 서버의 비공개 초안에 저장된다. 공개 제품 수정안은 검토 파일과 영수증에 보관한다. 두 파일은 비공개 작업 폴더에 보관한다.
5. 관리자 검토 후 `python scripts/product-pipeline.py publish review.json`을 실행한다. 새 제품은 검토 버전 확인, 제품 생성, 공급업체 연결을 한 트랜잭션에서 처리한다. 이 경로로 발견해 이미 공개한 제품은 수집 시점의 revision과 일치할 때 갱신한다. 본문과 갤러리를 교체하므로 검토 파일에 유지할 내용을 모두 포함한다. 카테고리나 원고·사진을 수정했으면 prepare를 다시 실행한다. 공개 후 공개 API, 검색 카드와 실제 썸네일 응답을 확인한다.
6. 동일 모델의 타 공급업체는 후보를 검토한 후 `python scripts/product-pipeline.py link SUPPLIER IDENTITY PRODUCT_ID`로 연결한다. 새 제품은 생성되지 않는다.

이미지 파일과 제품 데이터는 운영 API에 바로 저장되며 제품마다 사이트 재배포할 필요가 없다. 제품 공개 응답이 유실되면 list에서 결정과 product_id를 먼저 확인한다.

제조사가 상세 정보를 JSON으로 제공하면 collect에 `--json-url 공식_API_URL --record data.products.0 --model-field model --text-field paragraphs --images-field images`를 붙인다. record와 필드명은 실제 응답 구조에 맞춰 지정한다. 모델명이 일치하는 레코드의 본문 문자열과 사진 URL 배열을 수집한다.

여러 제품 작업은 `python scripts/product-pipeline.py session`을 한 번 시작해 관리자 세션을 재사용한다. 표준 입력에 한 줄씩 JSON 배열(예: `["scan","inbody"]`, `["list"]`)을 보내면 각 명령이 JSON 한 줄로 응답한다. 검토가 끝난 파일만 publish 명령으로 전달한다.


## Windows MCP 제품 등록 전용 연결

같은 Windows 계정에서 다음 명령을 실행하면 만료 시간과 승인용 ID가 표시됩니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\guide-publish.ps1 -Action pair -ConnectionScope product
```

메디컬마켓 운영 화면에서 **제품 안내 관리 → 제품 등록 API 연결**을 열고 표시된 ID를 입력해 승인합니다. 연결 요청은 30분 동안 유효하며 같은 메뉴에서 승인된 연결을 해제할 수 있습니다. MCP 호스트에서 `scripts/guide-publish-mcp.py`를 다시 로드하면 `product_status`, `upload_product_photo`, `save_product`가 표시됩니다.

`product_status`로 연결 상태를 확인합니다. `upload_product_photo`에는 작업 폴더 내부의 WebP 파일 절대 경로를 전달합니다. 반환된 주소를 제품의 `image`와 `gallery`에 지정합니다. `save_product`의 `product` 필드는 기존 제품 등록 API 형식이며, `published`를 false로 보내면 비공개 초안, true로 보내면 공개 제품을 생성합니다. 이 연결은 신규 제품만 등록할 수 있습니다. 기존 제품 수정·삭제와 블로그 발행 권한은 별도입니다.
