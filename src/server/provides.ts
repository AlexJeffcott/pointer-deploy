const FILE = new URL("./blocks.provides.json", import.meta.url);

export async function blocksWritten(file: URL = FILE): Promise<Record<string, string>> {
  return (
    ((await Bun.file(file)
      .json()
      .catch(() => null)) as Record<string, string> | null) ?? {}
  );
}
