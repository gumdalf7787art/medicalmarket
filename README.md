# Medical Market Season 2

의료기기 견적 요청 플랫폼의 React 19 + Vite 화면 및 로컬 기능 개발용 코드입니다.

## React 실행·빌드
Node.js 22.12 이상을 사용합니다.
Cloudflare 빌드는 `.node-version`에 지정한 Node.js 24.12.0을 사용합니다. 기존 `NODE_VERSION` 환경변수가 있다면 같은 버전으로 맞추거나 삭제하세요.

```sh
npm ci
npm run dev
npm run build
```

`npm run dev`는 화면 개발용입니다. `npm run build`의 공개 결과물은 `dist/`에 생성됩니다.
Cloudflare Pages 설정: Framework preset `React (Vite)`, Build command `npm run build`, Build output directory `dist`, Production branch `main`.
환경변수에 Gmail 앱 비밀번호를 프런트엔드 변수로 넣지 않습니다.

React가 공통 헤더, 운영 레이아웃과 고객·운영 페이지 렌더링을 담당합니다.
기존 업무 모듈은 `scripts/domain-files.json` 순서로 하나의 ES 모듈로 빌드되며, 저장 키·업무 규칙·API 요청을 유지합니다.
기존 문자열 템플릿은 React 요소로 변환합니다. 제품 설명 편집기와 부분 갱신 영역은 커서·실행 취소를 보존하기 위해 DOM 호환 영역으로 관리합니다. 모든 내부 로직을 JSX/Hooks로 재작성한 상태는 아닙니다.

## 검증
```sh
npx playwright install chromium
npm run build
npm test
```
제품 편집·관심제품·단일 견적 요청·공급업체 수정·메일함·첨부 다운로드·고객 견적 계산·모바일 운영 메뉴를 Chromium에서 확인합니다.
테스트는 격리된 브라우저와 가상 API만 사용하며 실제 이메일을 보내지 않습니다.

## 공개본 범위
- 홈페이지·제품 탐색·제품 에디터·운영자 화면·공급사 의뢰·메일함·고객 견적 PDF 코드.
- 제품 120개와 장비 그림은 가상 샘플이며 실제 제품·가격 정보가 아닙니다.
- 기존 DB, 회원·공급업체 연락처, 기존 제품 설명·사진·첨부, 실제 요청·메일·견적, 사업자등록증, 비밀번호, 기존 Git 기록은 포함하지 않습니다.
- 원본 개발 폴더와 독립된 신규 공개 저장소입니다.

## 로컬 실행
화면은 `npm run dev` 또는 빌드한 `dist/`를 정적 서버로 제공해 확인합니다. 메일·업로드·PDF 기능은 별도의 Python API 서버 연결이 필요합니다. 기존 `serve_local.py`는 로컬 개발용 API 구현이며 Cloudflare Pages에서 자동 실행되지 않습니다.

## 개발 상태 및 배포
배포된 사이트의 제품 정보는 D1, 사진은 R2에 저장됩니다. 제품 관리에는 운영자 비밀번호 로그인이 필요합니다. 설정은 [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md)를 확인하세요. 회원·견적 등 나머지 데이터는 아직 브라우저 방식입니다. 현재 서버는 로컬 전용입니다. 인증 없이 운영 서버로 공개하지 마세요. GitHub 공개는 Cloudflare 배포를 의미하지 않습니다.

## 메일 및 파일 설정
기본 발신·참조 주소와 회사 정보는 예시로 치환되어 있습니다. 실제 연동 시 서버 환경변수 `MEDICALMARKET_MAIL_SENDER`, `MEDICALMARKET_MAIL_COPY` 및 화면의 예시 주소·회사 서명을 함께 설정해야 합니다. 앱 비밀번호는 화면에서 입력하며 서버 메모리에만 보관합니다. 비밀번호나 운영 자료를 Git에 추가하지 마세요.
`MEDICALMARKET_PRIVATE_DIR`는 웹 루트 밖의 비공개 경로로 설정하세요. 기본값은 저장소 옆 `medicalmarket-private/mail`입니다. 사업자등록증은 별도 등록이 필요합니다. PDF 한글 폰트는 현재 Windows 맑은 고딕 경로를 사용하므로 다른 OS에서는 별도 폰트 설정이 필요합니다.

## 업무 범위
고객 요청 → 공급업체 문의 → 회신 확인 → 판매가·조건 검토 → 고객 견적 발송. 주문·결제·납품 관리는 포함하지 않습니다.

## 회원 마이페이지

- 로그인 후 상단 **마이페이지** 또는 `/#account`에서 접속합니다.
- 메뉴: 마이페이지 홈 / 내 견적 요청 / 받은 견적서 / 관심제품 / 병원·연락처 정보 / 내 계정.
- Cloud 배포에서는 요청과 관심제품을 로그인한 회원 ID 기준으로 D1에 저장합니다. 병원·연락처 수정은 이후 요청에 적용하며 과거 요청의 내용은 보존합니다.
- 고객 진행 단계: 요청 접수 → 공급업체 확인 중 → 견적 작성 중 → 견적서 도착. 접수 단계에서는 고객이 취소할 수 있습니다.
- 운영자 **회원 견적 요청** (`/#ops/customerRequests`)에서 상태를 변경하고 고객용 금액·조건·PDF를 등록합니다. 등록된 PDF는 PRIVATE_FILES에 저장하며 해당 회원만 다운로드할 수 있습니다. 이 등록 작업 자체는 이메일을 발송하지 않습니다.
- 기존 DB / PRIVATE_FILES 바인딩을 그대로 사용합니다. 필요한 `mm_member_profiles`, `mm_favorites`, `mm_requests`, `mm_customer_quotes`, `mm_request_events` 테이블은 첫 API 접근 시 생성됩니다.
- 예전 브라우저에만 저장한 시안 견적은 회원 소유권을 확인할 수 없으므로 자동으로 새 회원에게 연결하지 않습니다. 기존 로컬 업무 화면은 유지됩니다.
- 검증: `node --test tests/member.test.js` (실제 SQLite 기반 회원 간 접근 분리·상태 변경·PDF), `node tests/member-ui.cjs` (빌드 후 모의 API를 이용한 PC·모바일 화면과 입력 검증). 실제 이메일 발송이나 회원 계정 생성 없이 실행됩니다.
