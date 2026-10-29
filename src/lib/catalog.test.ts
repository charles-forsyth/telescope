import { describe, expect, it, beforeEach } from "vitest";
import { hasTool, setCatalogForTest } from "./catalog";
import { commonPrefix } from "./format";

describe("optional tools are checked at runtime", () => {
  beforeEach(() => setCatalogForTest(null));

  it("a tool is absent until the catalogue is loaded", () => {
    expect(hasTool("skywalker_credits")).toBe(false);
  });

  it("skywalker_credits is reported present only when the server lists it", () => {
    setCatalogForTest(["skywalker_spend_all", "skywalker_fleet"]);
    expect(hasTool("skywalker_credits")).toBe(false);
    setCatalogForTest(["skywalker_spend_all", "skywalker_credits"]);
    expect(hasTool("skywalker_credits")).toBe(true);
  });
});

describe("commonPrefix shortens project ids without hiding the difference", () => {
  it("strips the shared lab prefix at a dash boundary", () => {
    const ids = ["demo-lab-aurora", "demo-lab-basalt", "demo-lab-cirrus"];
    expect(commonPrefix(ids)).toBe("demo-lab-");
    expect(ids[0].slice(commonPrefix(ids).length)).toBe("aurora");
  });

  it("returns nothing for a single id or ids with no shared dash boundary", () => {
    expect(commonPrefix(["demo-lab-x"])).toBe("");
    expect(commonPrefix(["abc", "abd"])).toBe("");
  });

  it("never cuts inside a word", () => {
    const ids = ["demo-lab-aurora", "demo-lab-auro"];
    expect(commonPrefix(ids)).toBe("demo-lab-");
  });
});
