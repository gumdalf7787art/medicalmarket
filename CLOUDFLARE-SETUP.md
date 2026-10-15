# D1·R2 연결

## Cloudflare 대시보드에서 할 일

Workers & Pages → medicalmarket → Settings에서 Production 환경을 선택합니다.
Bindings → Add를 눌러 아래 연결을 추가합니다. 변수 이름은 대소문자까지 일치해야 합니다.

| 종류 | 변수 이름 | 리소스 |
| --- | --- | --- |
| D1 database | DB | medicalmarket-db |
| R2 bucket | MEDIA | medicalmarket-assets |
| R2 bucket | PRIVATE_FILES | medicalmarket-private |

Variables and secrets → Add → Type: Secret으로 `CLOUD_ADMIN_KEY`를 추가합니다.
값은 영문·숫자가 섞인 24자 이상의 별도 관리자 연결 키입니다. Gmail 앱 비밀번호를 사용하지 않습니다.
이 키를 GitHub, 채팅, VITE_ 변수에 넣지 않습니다.

저장 후 Deployments에서 최신 커밋을 다시 배포합니다.
빌드는 `npm run build`, 출력은 `dist`, 루트 디렉터리는 비워둡니다.
저장소 루트의 functions 폴더가 Pages Functions로 배포됩니다.
R2 공개 URL은 두 버킷 모두 비활성화 상태로 유지합니다.
Preview에는 운영 리소스를 연결하지 않습니다. 필요할 때 별도 테스트 저장소를 만듭니다.

## 연결 확인

배포된 홈페이지의 운영 화면 → 클라우드 연결(`#ops/cloud`)에서 관리자 연결 키를 입력하고 연결 확인을 누릅니다.
서버가 D1 점검 테이블에 임시 행을 쓰고 조회 후 삭제하며, R2 두 곳에도 임시 파일을 저장하고 읽은 뒤 삭제합니다.
빈 점검 테이블 `mm_connection_checks`는 남습니다. 실제 제품·회원·견적 데이터에는 접근하지 않습니다.
키는 브라우저 저장소에 저장하지 않습니다. 키 변경은 Cloudflare Secret 변경 및 재배포로 가능합니다.

## 현재 범위와 다음 작업

이번 구현은 서버 측 D1·R2 바인딩과 실제 읽기·쓰기 점검입니다.
현재 제품·회원·견적 화면의 브라우저 저장 방식은 아직 D1으로 이전되지 않았습니다.
기존 자료의 자동 업로드나 실제 Gmail 서버 이전도 하지 않습니다.
후속 작업은 운영자·회원 인증과 권한 설정, 업무 테이블 및 API 구현,
제품·카테고리·공급업체 저장 전환, 사진·첨부 업로드 전환,
견적 요청·회신·고객 견적 저장 전환 순서로 진행합니다.
연결 키는 초기 연결 확인 전용이며 전체 서비스 로그인 기능을 대신하지 않습니다.
