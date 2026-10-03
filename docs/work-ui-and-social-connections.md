# Work UI, office activity and direct SNS connections

2026-10-03

## Changes

- Advanced tasks: searchable/filterable task list, status counts, progress, assigned worker/current step summary and responsive pipeline. Fixed unordered-list items inheriting a 28px step-marker column, which broke worker and artifact text.
- Home: project-scoped live work panel showing task title, progress, assigned workers and current step; clicking opens that task. Paused/interrupted tasks stay visible and recently updated tasks sort first.
- Idle office: unassigned idle/waiting agents repeatedly roam open lounge/garden cells with staggered rests. Work assignments take precedence. Offline agents stay hidden. Reduced-motion turns decorative roaming off. Unreachable routes no longer become direct lines through walls.
- Models: explicit catalog refresh and account-specific availability explanation. Live OAuth GET `/v1/models` returned five visible slugs: gpt-6-astra, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5. GPT-6.1 Sol/GPT-6 Sol were absent from this account response; neither is excluded by client filtering. Hidden service models remain excluded.

## Direct SNS connection setup

User selected direct SNS login rather than Buffer. Settings → SNS provides Threads, Instagram, X, YouTube and Reddit cards. Existing Threads flow remains; four new flows exchange authorization codes server-side, verify account/channel identity, save isolated credentials, expose safe connection metadata, handle denial and disconnect. New flows request account/read-only scopes. They do **not** advertise publishing capability.

| Network | Required server configuration | Account requirements |
| --- | --- | --- |
| Threads | THREADS_APP_ID, THREADS_APP_SECRET, THREADS_REDIRECT_URI | Configured Threads developer app and user approval |
| Instagram | INSTAGRAM_CLIENT_ID, INSTAGRAM_CLIENT_SECRET, INSTAGRAM_REDIRECT_URI | Professional Instagram account and approved Instagram Login app |
| X | X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI | OAuth 2.0 confidential app with PKCE and permitted API access |
| YouTube | YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI | Google OAuth web app, YouTube Data API v3 enabled, channel owner approval |
| Reddit | REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REDIRECT_URI; REDDIT_USER_AGENT recommended | Reddit web application and permitted API access |

Register callback URLs exactly as shown in `.env.example`, then restart the local server and click the service's Connect button yourself. Store secrets in the server environment, never in chat or client VITE variables. No real SNS connection was performed: developer credentials are absent in the current local environment.

### Current limits

Four new flows run on the local server only. Cloud/serverless is disabled until distributed conditional state consumption and cancellation are implemented. Channel operations are serialized within the single local server process; do not run several local servers against one credential directory. Callback state is fresh, durable, single-use and expires after 10 minutes. Reauthorization is required after access-token expiry; automatic refresh is not implemented for the four new flows. Local disconnect clears credentials; revoke the application's permission in the SNS account settings as well.

Threads has its existing publishing adapter. Instagram/X/YouTube/Reddit have account linking only; posting is still unavailable. Actual provider approval, scope compatibility and token/profile exchange have not been tested with real accounts. Instagram official documentation fetch was gated by login/rate limit during this implementation, so its endpoints require real developer-app verification before claiming production support.

## Verification

- Direct SNS fixture: four synthetic provider code exchanges/profile checks, state rejection, replay rejection, denial preserving an existing connection, secret isolation, superseded sign-in, serialized callback/disconnect and cloud guard.
- Idle movement fixture: 96 trips / 31,130 sampled frames, walkable cells, bounded speed, directional sprite frames, pauses, work precedence and unreachable-route handling.
- Existing Threads and Social Connector fixtures, workspace typecheck/build and diff check.
- Browser verification: actual interrupted task at 10% rendered readable worker/artifact summary and two-column pipeline; home showed its real state. Two timed DOM observations showed all nine unassigned agents changing positions within the office. An isolated component fixture verified worker name and running → approval → running transitions without changing saved project data. SNS screen reported 0/5 connections and missing developer-app configuration. No paid inference or SNS post was performed.

## Official references

[OpenAI account model catalog](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [X OAuth](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [YouTube OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps), [Reddit OAuth](https://github.com/reddit-archive/reddit/wiki/OAuth2), [Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/).
