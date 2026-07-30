# Unified `/v1` backend endpoints

The console talks to the unified Hanzo Cloud backend (`hanzoai/cloud`).
Base URL: `${NEXT_PUBLIC_CLOUD_URL}/v1`. All requests send cookie
credentials; responses are the envelope `{ status, msg, data, total }` (`total`
is the row count on list endpoints; the legacy `data2` count is still accepted
as a fallback until every emitter finishes the rename).

Client modules live in `src/lib/api/`.

## Account / session — `AccountApi`

| Method | Endpoint |
| --- | --- |
| `current()` | `GET /get-account` |
| `signin(code, state)` | `POST /signin?code&state` |
| `signout()` | `POST /signout` |

## Providers — `ProviderApi`

| Method | Endpoint |
| --- | --- |
| `listGlobal()` | `GET /get-global-providers` |
| `list({ owner, store, p, pageSize, … })` | `GET /get-providers` |
| `get(owner, name)` | `GET /get-provider?id=owner/name` |
| `add(p)` | `POST /add-provider` |
| `update(owner, name, p)` | `POST /update-provider?id=owner/name` |
| `remove(p)` | `POST /delete-provider` |
| `refreshMcpTools(p)` | `POST /refresh-mcp-tools` |

## Model routes — `ModelRouteApi`

| Method | Endpoint |
| --- | --- |
| `list({ owner, … })` | `GET /get-model-routes` |
| `get(owner, modelName)` | `GET /get-model-route?owner&modelName` |
| `add(r)` | `POST /add-model-route` |
| `update(owner, modelName, r)` | `POST /update-model-route?owner&modelName` |
| `remove(r)` | `POST /delete-model-route` |

## Applications — `ApplicationApi`

| Method | Endpoint |
| --- | --- |
| `list({ owner, … })` | `GET /get-applications` |
| `get(owner, name)` | `GET /get-application?id=owner/name` |
| `add(a)` | `POST /add-application` |
| `update(owner, name, a)` | `POST /update-application?id=owner/name` |
| `remove(a)` | `POST /delete-application` |
| `deploy(a)` | `POST /deploy-application?id=owner/name` |
| `undeploy(owner, name)` | `POST /undeploy-application?id=owner/name` |

## Stores — `StoreApi`

| Method | Endpoint |
| --- | --- |
| `listGlobal()` | `GET /get-global-stores` |
| `list(owner)` | `GET /get-stores?owner` |
| `get(owner, name)` | `GET /get-store?id=owner/name` |
| `names(owner)` | `GET /get-store-names?owner` |
| `add(s)` | `POST /add-store` |
| `update(owner, name, s)` | `POST /update-store?id=owner/name` |
| `remove(s)` | `POST /delete-store` |
| `refreshVectors(s)` | `POST /refresh-store-vectors` |

## Chat — `ChatApi`

| Method | Endpoint |
| --- | --- |
| `listGlobal({ … })` | `GET /get-global-chats` |
| `list({ user, store, selectedUser, … })` | `GET /get-chats` |
| `get(owner, name)` | `GET /get-chat?id=owner/name` |
| `add(c)` | `POST /add-chat` |
| `update(owner, name, c)` | `POST /update-chat?id=owner/name` |
| `remove(c)` | `POST /delete-chat` |
