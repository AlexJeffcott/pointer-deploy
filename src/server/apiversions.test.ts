import { describe, expect, test } from "bun:test";
import { apiVersionsUrl, parseApiVersions } from "./apiversions.ts";

describe("apiVersionsUrl", () => {
  test("sits at the root of the service, with or without a trailing slash", () => {
    expect(apiVersionsUrl("https://api.test")).toBe("https://api.test/versions");
    expect(apiVersionsUrl("https://api.test/")).toBe("https://api.test/versions");
  });
});

// Nothing compiles what the service sends. Every shape below is one this server
// can really receive: an older service, a proxy's error page, a field that
// somebody renamed without reading this repository.
describe("parseApiVersions", () => {
  test("accepts a list of versions", () => {
    expect(parseApiVersions({ serves: ["v1", "v2"] })).toEqual(["v1", "v2"]);
  });

  // A service that answers nothing is a reading, not a fault. The gate then
  // refuses every shell that names a version, which is correct.
  test("accepts a service that answers none", () => {
    expect(parseApiVersions({ serves: [] })).toEqual([]);
  });

  test("rejects a document that is not an object", () => {
    expect(() => parseApiVersions(null)).toThrow("api versions is not an object");
    expect(() => parseApiVersions("v1")).toThrow("api versions is not an object");
  });

  test("rejects a serves that is not an array", () => {
    expect(() => parseApiVersions({})).toThrow("serves is not an array");
    expect(() => parseApiVersions({ serves: "v1" })).toThrow("serves is not an array");
  });

  // The position, because a list of ten with one bad entry is otherwise a
  // message that names nothing an operator can go and look at.
  test("rejects an entry that is not a string, and names its position", () => {
    expect(() => parseApiVersions({ serves: ["v1", 2] })).toThrow("serves[1] is not a string");
    expect(() => parseApiVersions({ serves: [""] })).toThrow("serves[0] is not a string");
  });
});
