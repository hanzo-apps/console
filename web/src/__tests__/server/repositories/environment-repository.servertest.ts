import {
  createTracesCh,
  createTrace,
  getEnvironmentsForProject,
} from "@hanzo/console/src/server";
import { randomUUID } from "crypto";

describe("Datastore Project Repository Test", () => {
  it("should return default if no environments are found", async () => {
    const projectId = randomUUID();
    const environments = await getEnvironmentsForProject({ projectId });
    expect(environments).toHaveLength(1);
    expect(environments[0].environment).toEqual("default");
  });

  it("should return environment from project_environments table after new trace was inserted", async () => {
    const projectId = randomUUID();
    const environmentId1 = randomUUID();
    const environmentId2 = randomUUID();
    await createTracesCh([
      createTrace({
        project_id: projectId,
        environment: environmentId1,
      }),
      createTrace({
        project_id: projectId,
        environment: environmentId1,
      }),
      createTrace({
        project_id: projectId,
        environment: environmentId2,
      }),
    ]);

    const environments = await getEnvironmentsForProject({ projectId });

    expect(environments).toHaveLength(3);
    expect(environments).toEqual(
      expect.arrayContaining([
        { environment: environmentId1 },
        { environment: environmentId2 },
        { environment: "default" },
      ]),
    );
  });

  it("should accept a fromTimestamp Date without a datastore BAD_QUERY_PARAMETER error", async () => {
    // Regression: a raw JS Date used to reach the datastore as
    // Date.prototype.toString() ("Fri Jun 19 2026 ... GMT+0000"), which
    // ClickHouse rejects for DateTime64(3) (Code: 457 BAD_QUERY_PARAMETER).
    // The repository must serialize Date params the one canonical way, via
    // convertDateToDatastoreDateTime, like every other repository.
    const projectId = randomUUID();
    const environmentId = randomUUID();
    await createTracesCh([
      createTrace({
        project_id: projectId,
        environment: environmentId,
        timestamp: Date.now(),
      }),
    ]);

    const environments = await getEnvironmentsForProject({
      projectId,
      fromTimestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    expect(environments).toEqual(
      expect.arrayContaining([
        { environment: environmentId },
        { environment: "default" },
      ]),
    );
  });
});
