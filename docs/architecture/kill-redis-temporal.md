# Kill Redis → Temporal-backed `@hanzo/mq`

CTO mandate: "kill redis, we don't use that anymore." Console (Langfuse fork)
used Redis for four things; this document records the migration of all four off
Redis, the backend decision, and the honest remaining tail.

## Backend decision: Temporal (not `hanzoai/tasks`) — for now

Two candidates were investigated against the live `hanzo-k8s` cluster:

| | `hanzoai/tasks` | Temporal |
|---|---|---|
| In-cluster | `tasks` pod (`ghcr.io/hanzoai/tasks:v3.3.1`), svc `tasks:80/9999`, `tasks-zap` LB | `temporal` pod (`temporalio/auto-setup:1.29.6`), svc `temporal:7233`, ready, Postgres-backed |
| Wire | luxfi/zap binary only (no gRPC, no protobuf) | gRPC `:7233` |
| TS/JS SDK | **none** — Go ZAP client + JSON shim only; `luxfi/zap` has Go+Rust bindings, no TS | **first-class** `@temporalio/{client,worker,workflow,activity}` |
| Workflow engine | native server returns **501 "not yet implemented"** for workflow ops (rip-in-progress; engine is "next build phase") | mature, GA |

`hanzoai/tasks` is the intended Hanzo-native durable-execution abstraction, but
today it has (a) no TypeScript client and (b) no working execution engine in the
native server. Driving it from a Next.js/Node codebase would mean writing a
brand-new TS ZAP client against an engine that 501s — that is cutting a corner
(a fake client), exactly what we don't do.

Temporal is live, ready, and has the canonical TS SDK. Console is a TS app.
**Decision: Temporal directly**, behind a driver seam so that when `hanzoai/tasks`
ships a TS client + engine, the backend swaps in one file
(`packages/mq/src/drivers/`).

Runtime infra the new backend needs:
- Temporal frontend gRPC address. In-cluster: `temporal.hanzo.svc:7233`
  (or `temporal:7233` from the same namespace). Env: `TEMPORAL_ADDRESS`.
- A Temporal namespace per deployment. Env: `TEMPORAL_NAMESPACE`
  (default `default`). Console maps each BullMQ queue → a Temporal Task Queue.
- No Redis. No `REDIS_*`.

## Architecture: one seam, `@hanzo/mq`

The entire codebase (producers in `packages/shared/src/server/redis/*` via
`getQueue()` / `XxxQueue.getInstance()`, consumers in `worker/src` via
`WorkerManager.register()`) talks to **one** module: `@hanzo/mq`, which was an
alias `npm:bullmq`. That alias is the decomplecting seam.

`@hanzo/mq` becomes a real workspace package: a BullMQ-API-compatible facade
with a pluggable **driver**. Producers/consumers are untouched — they keep
importing `Queue`, `Worker`, `Job`, `Processor`, `WorkerOptions`,
`QueueEvents` from `@hanzo/mq`.

```
packages/mq/
  src/
    index.ts            # re-exports Queue, Worker, QueueEvents, types
    types.ts            # JobsOptions, WorkerOptions, Processor, Job, ...
    queue.ts            # Queue facade (.add/.addBulk/.count/.getJob*/.close/.obliterate/.on)
    worker.ts           # Worker facade (ctor, .on, .close, .isRunning, .run)
    queueEvents.ts      # QueueEvents facade (.on, .close)
    driver.ts           # Driver interface + active-driver resolution
    drivers/
      memory.ts         # in-process driver (dev/test/no-Temporal) — default fallback
      temporal.ts       # Temporal driver (@temporalio/client + worker)
```

### BullMQ API surface actually used (measured)

Producer: `.add()`, `.addBulk()`. Worker: ctor `new Worker(name, processor,
opts)`, `.on("failed"|"error"|"completed"|...)`, `.close()`, `.isRunning()`.
Introspection (metrics/admin): `.count()`, `.getWaitingCount()`,
`.getFailedCount()`, `.getDelayedCount()`, `.getActiveCount()`,
`.getJobCounts()`, `.getJobs()`, `.getJob()`, `.remove()`, `.obliterate()`,
`.drain()`. Options used: `attempts`, `backoff`, `delay`, `removeOnComplete`,
`removeOnFail`, `deduplication`, `jobId`, repeatable/cron (`pattern`),
`concurrency`, `limiter`.

### Queue → Temporal mapping

- BullMQ queue name → Temporal **Task Queue** name (sharding suffix preserved:
  `ingestion-queue-3`).
- `queue.add(jobName, payload, opts)` → start a Temporal Workflow execution on
  that task queue that invokes a single generic activity carrying
  `{ name, payload }`; or, for high-throughput fire-and-forget, signal a
  long-running dispatcher workflow. (See `drivers/temporal.ts`.)
- BullMQ `attempts` + `backoff` → Temporal `RetryPolicy`
  (`maximumAttempts`, `initialInterval`, `backoffCoefficient`).
- BullMQ `delay` → Workflow `startDelay`. Repeatable/cron → Temporal Schedules.
- `Worker(name, processor)` → a Temporal Worker registered on that task queue
  whose activity implementation calls `processor(job)` with a BullMQ-shaped
  `Job` (`{ id, name, data, timestamp, attemptsMade, ... }`).

### Driver selection

`TEMPORAL_ADDRESS` set ⇒ Temporal driver. Otherwise ⇒ in-memory driver
(keeps local dev and CI green with zero infra, same as BullMQ-on-local-redis
used to require redis). The memory driver runs processors in-process with the
same retry/delay semantics, so the build and unit tests are hermetic.

## Cache + locks (the other three Redis uses)

2. **Caches** (API-key cache, model-match cache, prompt cache): replaced with an
   in-process LRU (`packages/shared/src/server/cache`) — bounded, TTL'd. The
   app DB is SQLite now (single-writer, co-located), so a cross-process cache
   buys little; per-process LRU is the DRY fit. Cache invalidation that used
   redis pub/sub becomes a no-op locally + a short TTL.
3. **Rate limiting**: the redis-backed limiter degrades to in-process token
   buckets (LRU-keyed). Documented exception if any limiter needs cross-pod
   accuracy — gateway (`hanzoai/gateway`) is the cross-pod rate-limit authority
   in the Hanzo stack, not the app.
4. **Distributed locks** (`RedisLock`): replaced with a SQLite/Base advisory
   lock (`AdvisoryLock`) using the app DB. Same `withLock()` API + ownership
   token + TTL semantics; `onUnavailable` preserved.

## Checkpoints (each is a green `next build --webpack`)

0. This doc + branch.
1. `@hanzo/mq` facade package (memory + temporal drivers).
2. Swap alias `@hanzo/mq` → `workspace:*`; neutralize `redis.ts`.
3. Replace caches with LRU.
4. Replace `RedisLock` with `AdvisoryLock`.
5. Remove `ioredis` dep + `REDIS_*` env (or document exceptions).

## Verification

- `cd web && SKIP_ENV_VALIDATION=1 NEXT_IGNORE_BUILD_ERRORS=true npx next build --webpack` → exit 0 at each checkpoint.
- End state: 0 `ioredis` imports, 0 `REDIS_*` env references (or documented).
</content>
</invoke>
