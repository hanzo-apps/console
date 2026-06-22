export default async function teardown() {
  const { redis, logger } = await import("@hanzo/console/src/server");

  logger.debug(`Redis status ${redis?.status}`);
  if (redis && redis.status !== "end" && redis.status !== "close") {
    redis.disconnect();
  }

  await DatastoreClientManager.getInstance().closeAllConnections();

  logger.debug("Teardown complete");
}
