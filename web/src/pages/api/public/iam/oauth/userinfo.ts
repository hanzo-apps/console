// Companion to ./token: the embedded `@hanzo/iam` BrowserIamSdk fetches the OIDC
// profile at `${proxyBaseUrl}/oauth/userinfo`. The userinfo proxy handler lives
// at `../auth/userinfo`; expose it at the canonical `/v1/iam/oauth/userinfo`
// path the SDK calls (middleware maps `/v1/iam/oauth/userinfo` ->
// `/api/public/iam/oauth/userinfo`).
import handler from "../auth/userinfo";

export default handler;
