# 공급업체 Gmail 회신 자동 확인

Cloudflare Pages는 이 저장소의 웹사이트를 배포하고, 이 별도 Worker의 Cron Trigger가 5분마다 회신 연결 API를 호출합니다. Worker에는 Gmail 토큰이나 D1 연결 정보가 필요하지 않습니다.

1. 영문·숫자로 된 무작위 32자 이상의 새 값을 만듭니다. 기존 비밀번호, Gmail 키, OAuth 비밀키를 재사용하지 않습니다.
2. Cloudflare Pages `medicalmarket` → **Settings → Variables and secrets** → **Add**에서 `MAIL_SYNC_TOKEN`을 **Secret**으로 등록하고 Pages를 재배포합니다.
3. 같은 Cloudflare 계정에 Worker `medicalmarket-mail-reply-checker`를 배포합니다: `npx wrangler deploy --config worker/mail-reply-checker/wrangler.jsonc`.
4. Worker → **Settings → Variables and Secrets**에서 `MAIL_SYNC_TOKEN`을 **Secret**으로 등록합니다. 값은 1번과 정확히 같아야 합니다. CLI에서는 `npx wrangler secret put MAIL_SYNC_TOKEN --config worker/mail-reply-checker/wrangler.jsonc`를 사용할 수 있습니다.
5. Worker → **Settings → Triggers**에서 `*/5 * * * *` 예약 실행이 표시되는지 확인합니다. Cloudflare Cron은 UTC 기준이지만 이 식은 시간대에 상관없이 5분 간격입니다.

운영 화면이 열려 있을 때에도 약 5분마다 자동 확인합니다. 새 회신이 연결되면 운영 메뉴의 **공급사 의뢰·회신**에 건수가 표시됩니다. 회신을 검토한 뒤 **확인 완료**를 누르면 건수가 줄어듭니다. Gmail 연결이 만료되거나 공급업체가 발송 수신 주소와 다른 주소로 답장한 경우에는 자동 연결되지 않으므로 구글 메일 확인 화면에서 확인합니다.
