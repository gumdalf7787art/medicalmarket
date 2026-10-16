# Gmail OAuth connection

Cloudflare Pages production variables:

- `GMAIL_CLIENT_ID`: Secret, Google Web application OAuth client ID.
- `GMAIL_CLIENT_SECRET`: Secret, corresponding client secret.
- `GMAIL_SITE_URL`: Text, `https://medicalmarket.pages.dev`.
- Keep the existing `SITE_URL` used by member login unchanged. Gmail prefers `GMAIL_SITE_URL` and falls back to `SITE_URL` when omitted.
- Existing `DB` binding and operator authentication must remain configured.

Google Auth Platform → Clients → Web client → Authorized redirect URIs:

`https://medicalmarket.pages.dev/api/mail/oauth/callback`

Save settings and redeploy Pages. Open `/#ops/mail` as an operator and select Google account connection. Select the operational mailbox and grant Gmail read and send access. External apps in Testing need the account added as a test user; Gmail refresh authorization normally expires after seven days in this mode.

The connection checks the actual Gmail profile, stores AES-GCM encrypted tokens in D1, and refreshes access tokens on status checks. Encryption uses a domain-separated key derived from the server-only Gmail client secret. Changing that secret requires reconnecting. No credentials should be placed in frontend variables or GitHub. A failed reconnection leaves the previous connection intact.

The cloud edition supports Gmail mailbox browsing, reviewed supplier mail sending, and operator-triggered reply import. In `/#ops/replies` or a request detail, **Gmail 회신 가져오기** examines the Gmail conversations for sent supplier messages and links replies from the exact recipient address to the original request. The import is idempotent; opening the page alone does not sync mail. The operator can read linked text and download attachments up to 8 MB through the authorized Gmail connection. Attachment originals remain in Gmail and are not copied to R2. Replies from a different sender address or a new Gmail conversation require manual inspection in `/#ops/gmail` and are not auto-linked. Customer quote values and PDFs still require operator review and registration.

The overview shows the latest 100 sent requests and the batch sync checks the latest 20; use the request-detail sync button for an older request. Connecting Gmail does not automatically send any email.
