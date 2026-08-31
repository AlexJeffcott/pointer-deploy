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

export const apiVersionsUrl = (base: string): string => `${base.replace(/\/$/, "")}/versions`;
