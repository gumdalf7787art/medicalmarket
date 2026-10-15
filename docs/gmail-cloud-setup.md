# Gmail OAuth connection

Cloudflare Pages production variables:

- `GMAIL_CLIENT_ID`: Secret, Google Web application OAuth client ID.
- `GMAIL_CLIENT_SECRET`: Secret, corresponding client secret.
- `SITE_URL`: Text, `https://medicalmarket.pages.dev`.
- Existing `DB` binding and operator authentication must remain configured.

Google Auth Platform → Clients → Web client → Authorized redirect URIs:

`https://medicalmarket.pages.dev/api/mail/oauth/callback`

Save settings and redeploy Pages. Open `/#ops/mail` as an operator and select Google account connection. Select the operational mailbox and grant Gmail read and send access. External apps in Testing need the account added as a test user; Gmail refresh authorization normally expires after seven days in this mode.

The connection checks the actual Gmail profile, stores AES-GCM encrypted tokens in D1, and refreshes access tokens on status checks. Encryption uses a domain-separated key derived from the server-only Gmail client secret. Changing that secret requires reconnecting. No credentials should be placed in frontend variables or GitHub. A failed reconnection leaves the previous connection intact.

This change provides connection only. Cloud supplier sending, mailbox browsing, reply import and quote analysis are not enabled by this change; unsupported mail actions return 501. Existing local app-password behavior remains available in the local edition. Connecting Gmail does not automatically send any email.
