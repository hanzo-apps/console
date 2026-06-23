import {
  orgFromSub,
  isGlobalAdminIdentity,
  roleRank,
  parseLowerSet,
  parseEmailDomains,
} from "./iamSyncPolicy";
import { Role } from "@hanzo/console/src/db";

describe("orgFromSub", () => {
  it("extracts the org segment of an IAM sub", () => {
    expect(orgFromSub("admin/z")).toBe("admin");
    expect(orgFromSub("hanzo/alice")).toBe("hanzo");
  });
  it("returns undefined for malformed subs", () => {
    expect(orgFromSub("nouser")).toBeUndefined();
    expect(orgFromSub("/leading")).toBeUndefined();
    expect(orgFromSub("")).toBeUndefined();
  });
});

describe("isGlobalAdminIdentity", () => {
  const adminOrgs = parseLowerSet("admin");
  const adminEmailDomains = parseEmailDomains("hanzo.ai");

  it("treats a user owned by an admin org as global admin (a@/z@/woo@ in `admin`)", () => {
    expect(
      isGlobalAdminIdentity({
        ownerOrg: "admin",
        email: "z@hanzo.ai",
        adminOrgs,
        adminEmailDomains: [],
      }),
    ).toBe(true);
  });

  it("honors IAM isGlobalAdmin / isAdmin flags", () => {
    expect(
      isGlobalAdminIdentity({
        ownerOrg: "hanzo",
        email: "a@example.com",
        iamIsGlobalAdmin: true,
        adminOrgs,
        adminEmailDomains: [],
      }),
    ).toBe(true);
    expect(
      isGlobalAdminIdentity({
        ownerOrg: "hanzo",
        email: "a@example.com",
        iamIsAdmin: true,
        adminOrgs,
        adminEmailDomains: [],
      }),
    ).toBe(true);
  });

  it("grants global admin by email domain", () => {
    expect(
      isGlobalAdminIdentity({
        ownerOrg: "hanzo",
        email: "woo@hanzo.ai",
        adminOrgs,
        adminEmailDomains,
      }),
    ).toBe(true);
  });

  it("a normal user in a tenant org is NOT a global admin", () => {
    expect(
      isGlobalAdminIdentity({
        ownerOrg: "hanzo",
        email: "alice@hanzo.ai",
        adminOrgs,
        adminEmailDomains: [], // no domain grant configured
      }),
    ).toBe(false);
    expect(
      isGlobalAdminIdentity({
        ownerOrg: "acme",
        email: "bob@acme.com",
        adminOrgs,
        adminEmailDomains,
      }),
    ).toBe(false);
  });
});

describe("roleRank", () => {
  it("orders roles OWNER > ADMIN > ADMIN_BILLING > MEMBER > VIEWER > NONE", () => {
    expect(roleRank(Role.OWNER)).toBeGreaterThan(roleRank(Role.ADMIN));
    expect(roleRank(Role.ADMIN)).toBeGreaterThan(roleRank(Role.ADMIN_BILLING));
    expect(roleRank(Role.ADMIN_BILLING)).toBeGreaterThan(roleRank(Role.MEMBER));
    expect(roleRank(Role.MEMBER)).toBeGreaterThan(roleRank(Role.VIEWER));
    expect(roleRank(Role.VIEWER)).toBeGreaterThan(roleRank(Role.NONE));
  });
  it("never downgrades: MEMBER re-sync does not exceed an existing OWNER", () => {
    // mirrors upsertMembershipAtLeast: only upgrade when new > existing
    expect(roleRank(Role.MEMBER) > roleRank(Role.OWNER)).toBe(false);
    expect(roleRank(Role.OWNER) > roleRank(Role.MEMBER)).toBe(true);
  });
});

describe("parse helpers", () => {
  it("parseLowerSet trims, lowercases, drops empties", () => {
    expect([...parseLowerSet(" Admin , , Root ")]).toEqual(["admin", "root"]);
    expect([...parseLowerSet(undefined)]).toEqual([]);
  });
  it("parseEmailDomains strips @ and lowercases", () => {
    expect(parseEmailDomains("@Hanzo.ai, Lux.network")).toEqual([
      "hanzo.ai",
      "lux.network",
    ]);
  });
});
