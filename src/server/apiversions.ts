// The document the service publishes about itself, §13.
//
// `GET {API_BASE}/versions` answers `{ "serves": ["v1"] }`. It is unversioned,
// because a client that does not yet know which versions exist has to be able
// to ask - a discovery document behind a version answers nobody.
//
// Parsed here rather than trusted, for the reason the whole item exists: no
// compiler stands between this repository and that service. The service is a
// separate deploy on a separate schedule, and what it returns this afternoon is
// a fact about the running world.

/** Throws naming the field, in the same idiom as `parseManifest`. */
export function parseApiVersions(input: unknown): string[] {
  const doc = input as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") throw new Error("api versions is not an object");
  if (!Array.isArray(doc.serves)) throw new Error("api versions field serves is not an array");
  return doc.serves.map((v, i) => {
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`api versions field serves[${i}] is not a string`);
    }
    return v;
  });
}

/** Where the document sits, for a base with or without a trailing slash. */
export const apiVersionsUrl = (base: string): string => `${base.replace(/\/$/, "")}/versions`;
