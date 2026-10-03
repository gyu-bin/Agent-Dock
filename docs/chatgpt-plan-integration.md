# ChatGPT Plan integration — implementation and verification

2026-10-03. Official OSS/local app OAuth implemented. User completed real OAuth authorization. Exactly one live plan inference succeeded at 2026-10-03T09:55:59Z; synthetic fixtures provide additional protocol evidence.

1. **OAuth flow** — server opens the system browser only after a user clicks Continue with ChatGPT. Loopback callback listens on 127.0.0.1 with a dynamic port before authorization. State, nonce, S256 PKCE and exact redirect/resource are required.
2. **Host ID** — persisted opaque `urn:uuid:<UUIDv4>`; no email-derived host identifier.
3. **Dynamic registration** — initial `dynamic_agent_client` request; issued `oaiapp_` client ID validated at callback.
4. **Client persistence** — verified subject/client registration survives disconnect. Subsequent login uses saved client identity and ID token hint when present.
5. **Scopes** — openid/profile/email/offline_access/resource.invoke/chatgpt.tokens.use.direct requested; granted direct scope gates inference.
6. **ID validation** — jose verifies official discovery/JWKS signatures, issuer, audience, expiry and nonce; returning account and client must match.
7. **Credential storage** — server-only local file, 0700 directory/0600 files and atomic rename. Tokens are excluded from frontend status, artifact/usage payloads and logs. See [security details](chatgpt-oauth-security.md).
8. **Refresh** — in-process serialization and filesystem lock protect rotation; earliest refresh time respected. Temporary network failures retain credentials; revoked sessions require reauthorization.
9. **Plan permission** — signed-in and plan-enabled are separate. Missing scope yields a permission error.
10. **Catalog** — OAuth GET `/v1/models`; only visibility=list entries exposed. Slug used for requests; displayName in UI. Account changes clear cache.
11. **Responses adapter** — POST official `/v1/responses`, streamed. A terminal response.completed is required; interrupted or empty streams fail.
12. **Restrictions** — store=false, stream=true, input array, instructions from system context; no previous_response_id and no unsupported sampling/token-limit parameters. Full messages resubmitted.
13. **Vision/files** — image parts forwarded as input_image; text files normalized locally and document files sent as base64 input_file with filename. No file upload endpoint is used. Actual model/account capability is not live-verified. Unsupported inputs must fail explicitly; no Files API upload.
14. **Web search** — plan requests use hosted web_search when supported. Existing nonbillable search alternatives remain; API-key web search is excluded in plan mode.
15. **Unsupported capabilities** — classified plan errors; image generation remains separate API tool. No fake successful output after plan failure.
16. **Selection** — ChatGPT Plan default; API mode requires explicit setting. Key presence does not switch selection.
17. **API compatibility** — existing key provider retained for explicit API mode, with separate API billing. Local Codex CLI remains the implementation provider.
18. **Settings UX** — Continue with ChatGPT, safe connected profile, model catalog, account change/disconnect, explicit Plan/API selection and collapsed API details. Project tool label distinguishes providers. Vercel displays local-only explanation.
19. **Errors** — sign-in/permission/limit/expired/unsupported states distinguished from API credit exhaustion. No automatic paid fallback.
20. **Usage** — provider=openai-chatgpt-plan, authMode=chatgpt-plan, tokens if supplied, costBasis=plan-included. No invented $0 cost; aggregate monetary cost remains unknown.
21. **A–J fixtures** — OAuth A–D and provider E–J pass with mocked token/model/response services and a real loopback test listener. Includes real synthetic RSA JWKS verification, returning registration, refresh races, scope denial, completion, limits, image separation and zero key calls after plan failure.
22. **Typecheck/build** — workspace typecheck and production build passed. Attachment A–N, canonical planning A–F, usage (10) and settings (12) regressions passed. No actual external paid inference performed by these tests.
23. **Actual OAuth** — user clicked and approved personally. Safe status confirmed supported=true, signedIn=true, planUsageEnabled=true. OAuth model catalog returned five available entries.
24. **Actual inference** — exactly one real Responses request succeeded using gpt-6-astra. Output: “ChatGPT 플랜 연결 확인 완료.” Usage: 21 input / 12 output tokens, provider=openai-chatgpt-plan, authMode=chatgpt-plan, costBasis=plan-included. No API key fallback or retry.
25. **Original market analysis** — not rerun because the requested maximum one real inference was used for the connection smoke test. This does not verify the full search→research→synthesis workflow.
26. **Limitations** — local OSS flow is disabled on Vercel/cloud. Availability depends on official account/model policy and plan limits. Missing/corrupt lock owner fails safely until repaired. Image API billing remains separate. Real vision/file/search capabilities need account verification.

## Office addition

Per the user's direct request, removed reception label, furniture and destination from the active pixel office. Former reception becomes an open lounge terrace, with the lounge south wall and garden glass partition opened. All 4,177 walkable cells and 58 destinations are connected. Browser screenshot confirms the active map; idle agents can use lounge/garden and offline agents are hidden.

## Official sources

[Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
