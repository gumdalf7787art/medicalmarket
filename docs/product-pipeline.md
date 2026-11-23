# 브라우저 없는 제품 수집 및 공개

프로젝트 루트에서 Node 프로젝트 의존성(`npm ci`)과 Python Pillow(`python -m pip install Pillow`)를 설치한다. 메디컬마켓 관리자 이메일과 비밀번호는 실행 환경의 `MM_PRODUCT_EMAIL`, `MM_PRODUCT_PASSWORD`에 공급한다. 명령행 인수, JSON, 저장소에 비밀번호를 기록하지 않는다. CLI는 매 실행 시 운영 로그인 API로 인증한다. 블로그 토큰은 제품 권한으로 사용할 수 없다.

1. `python scripts/product-pipeline.py scan inbody`로 공식 목록을 HTTP로 수집한다. 지원 키는 `inbody`, `alpinion`, `bistos0340`이다. `list`로 공급업체 ID, identity, 매칭 상태, 추천 카테고리를 조회한다.
2. `python scripts/product-pipeline.py collect KEY SUPPLIER IDENTITY review.json`으로 공식 상세 페이지의 본문, 사양표, 이미지 후보를 추출한다. 필요한 경우 `--selector "제품영역 CSS 선택자"`를 추가한다. 모델 공용 페이지에서는 해당 모델의 사양과 이미지를 선별한다. HTML에 없는 자료는 제조사의 공식 데이터 응답에서 확인한 뒤 검토 파일에 보충한다. 수집에 실패하거나 자료가 빠지면 공개를 보류한다.
3. 검토 파일에서 paragraphs를 사실에 근거한 구매자용 설명으로 편집하고 category를 확인한다. images에는 해당 모델 사진을 모두 담고 본체 전경을 첫 번째로 둔다. 긴 이미지의 특정 영역은 이미지 항목에 `"crop": [left, top, right, bottom]`을 픽셀로 지정한다. 같은 원본을 다른 좌표로 여러 번 사용할 수 있다. 제조사 URL은 내부 수집 기록에만 둔다.
4. `python scripts/product-pipeline.py prepare review.json`으로 원본을 다운로드·크롭하고 WebP 원본 및 썸네일을 메디컬마켓 이미지 API에 저장한다. 같은 결과 파일은 해시로 재사용한다. 새 제품의 본문과 사진은 서버의 비공개 초안에 저장된다. 공개 제품 수정안은 검토 파일과 영수증에 보관한다. 두 파일은 비공개 작업 폴더에 보관한다.
5. 관리자 검토 후 `python scripts/product-pipeline.py publish review.json`을 실행한다. 새 제품은 검토 버전 확인, 제품 생성, 공급업체 연결을 한 트랜잭션에서 처리한다. 이 경로로 발견해 이미 공개한 제품은 수집 시점의 revision과 일치할 때 갱신한다. 본문과 갤러리를 교체하므로 검토 파일에 유지할 내용을 모두 포함한다. 카테고리나 원고·사진을 수정했으면 prepare를 다시 실행한다. 공개 후 공개 API, 검색 카드와 실제 썸네일 응답을 확인한다.
6. 동일 모델의 타 공급업체는 후보를 검토한 후 `python scripts/product-pipeline.py link SUPPLIER IDENTITY PRODUCT_ID`로 연결한다. 새 제품은 생성되지 않는다.

이미지 파일과 제품 데이터는 운영 API에 바로 저장되며 제품마다 사이트 재배포할 필요가 없다. 제품 공개 응답이 유실되면 list에서 결정과 product_id를 먼저 확인한다.

제조사가 상세 정보를 JSON으로 제공하면 collect에 `--json-url 공식_API_URL --record data.products.0 --model-field model --text-field paragraphs --images-field images`를 붙인다. record와 필드명은 실제 응답 구조에 맞춰 지정한다. 모델명이 일치하는 레코드의 본문 문자열과 사진 URL 배열을 수집한다.
