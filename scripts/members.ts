// Compatibility by USE, member by member, rather than by the whole surface.
//
// The contract hash asks "is this the same surface". That is the wrong question
// for the thing an operator actually needs to know, which is whether a shell
// and a sub-app fit each other. Under the hash, a member REMOVED from
// `ShellStore` breaks the shell's cell against every older contract, empties
// the intersection and refuses the promote - even when no sub-app in the
// composition ever called it. Two of the eight members of `ShellStore` are used
// by no sub-app at all, so that refusal is wrong twice over on this repository.
//
// The rule this file computes instead:
//
//   a member ADDED       changes nothing, because no app's use set grew
//   a member REMOVED     changes nothing for an app that never used it
//   a member REMOVED     refuses exactly the apps that used it, by name
//   a signature NARROWED refuses exactly the apps that used that member
//
// Use is measured by REMOVAL, never parsed. Cut one declaration out of the
// surface and recompile a unit against the rest: if it still compiles, that
// unit does not use the member. That is the same definition the rule needs, and
// tsc is the oracle for it - the same trick `falsify` plays on the scenarios.
//
// Only `shell.d.ts` is read here. It is the half a sub-app CONSUMES, so it is
// the half where "used" means anything. `subapp.d.ts` is what a sub-app
// produces; the whole of it is required of every app, and the contract hash
// covers it.

import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as ts from "typescript";
import { emitBlocks, filesFor, runTsc, type Surface, type Unit } from "./contract.ts";

const ROOT = ".contract-members";

/**
 * How many tsc processes to keep in flight, per reading.
 *
 * Half the cores, because `build.ts` starts two readings at once. Measured on
 * 2026-08-29, 12 cores: the pair takes about 10.5 s of an 11.9 s build at 6
 * lanes each and the same at 8, with the CPU at 1055%. The work is saturated
 * either way, so the lane count is not what to tune - the number of members is.
 */
const LANES = Math.max(2, Math.floor((navigator.hardwareConcurrency || 8) / 2));

export type Member = {
  /** "createStore", "ShellStore.reset", "User.name". */
  path: string;
  /** The declaration's own text. */
  text: string;
  /**
   * Of that text, with runs of whitespace collapsed.
   *
   * The text comes from `emitSurface`, which is tsc emitting declarations, so
   * its formatting is already canonical - the collapse only takes out
   * indentation and line endings. What moves a digest is a token: a narrowed
   * parameter, a changed return type, an added argument.
   */
  digest: string;
  start: number;
  end: number;
};

export type MemberReading = {
  /** Every removable member, path to digest. What a shell PROVIDES. */
  provides: Record<string, string>;
  /** Per unit, the members whose removal stops it compiling. What it USES. */
  uses: Record<string, Record<string, string>>;
  /**
   * Members whose removal breaks the surface itself, so no unit can be asked.
   *
   * `User` is one: `ShellStore.user(): User` names it, so a surface without it
   * does not parse as a surface. Removing it in earnest means removing
   * `ShellStore.user` too, and THAT member is probed - so the composite change
   * is covered by its parts and nothing is lost by leaving these out.
   */
  structural: string[];
  ms: number;
};

// -- reading the members ----------------------------------------------------

const digestOf = (text: string): string =>
  new Bun.CryptoHasher("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 7);

const named = (node: ts.Node): string | null => {
  const name = (node as { name?: ts.Node }).name;
  return name && "getText" in name ? (name as ts.Identifier).text : null;
};

/**
 * Every declaration in `shell.d.ts`, and every member of a type literal in one.
 *
 * Two levels is what the surface has and the recursion is general, so a type
 * literal nested inside another is reached too.
 */
export function membersOf(surface: Surface): Member[] {
  return membersIn(surface["shell.d.ts"], "shell.d.ts");
}

/** The same, over any declaration file's text. */
export function membersIn(text: string, name: string): Member[] {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const found: Member[] = [];

  const take = (node: ts.Node, path: string) => {
    const own = text.slice(node.getStart(file), node.getEnd());
    found.push({ path, text: own, digest: digestOf(own), start: node.getStart(file), end: node.getEnd() });
  };

  const descend = (type: ts.TypeNode | undefined, prefix: string) => {
    if (!type || !ts.isTypeLiteralNode(type)) return;
    for (const m of type.members) {
      const name = named(m);
      if (!name) continue;
      take(m, `${prefix}.${name}`);
      const inner = (m as { type?: ts.TypeNode }).type;
      descend(inner, `${prefix}.${name}`);
    }
  };

  for (const statement of file.statements) {
    const name = named(statement);
    if (!name) continue;
    take(statement, name);
    if (ts.isTypeAliasDeclaration(statement)) descend(statement.type, name);
    if (ts.isInterfaceDeclaration(statement)) {
      for (const m of statement.members) {
        const member = named(m);
        if (member) take(m, `${name}.${member}`);
      }
    }
  }

  // Longest path first, so a nested member is offered before the declaration
  // that contains it. Nothing depends on the order; a stable one is reportable.
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/** One file's text with a declaration cut out. */
function cut(text: string, member: Member): string {
  return text.slice(0, member.start) + text.slice(member.end);
}

// -- the probes -------------------------------------------------------------

/**
 * Does the surface still parse and typecheck as a surface?
 *
 * skipLibCheck is OFF, and it has to be: every error a cut declaration causes
 * lands inside a `.d.ts`, and with it on the whole probe reads as clean. This
 * is the same trap §8's direction reading hit.
 */
async function surfaceHolds(dir: string, spec: { name: string; files: Record<string, string> }): Promise<boolean> {
  const declarations = Object.keys(spec.files).map((f) => resolve(dir, f));
  const config = {
    extends: resolve("tsconfig.json"),
    compilerOptions: {
      noEmit: true,
      skipLibCheck: false,
      // See above. The type-only half of the surface is invisible without
      // this, and nothing in node_modules objects to being checked.
      types: [],
      paths: {
        "@pointer/shell": [resolve(dir, "shell.d.ts")],
        "@pointer/subapp": [resolve(dir, "subapp.d.ts")],
        "@pointer/blocks": [resolve(dir, "blocks.d.ts")],
      },
    },
    include: [],
    files: declarations,
  };
  const configPath = join(dir, "tsconfig-surface.json");
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return (await runTsc(configPath)).ok;
}

async function compileWith(
  files: string[],
  paths: Record<string, string[]>,
  workDir: string,
): Promise<{ ok: boolean; output: string }> {
  await mkdir(workDir, { recursive: true });
  const config = {
    extends: resolve("tsconfig.json"),
    compilerOptions: { noEmit: true, baseUrl: resolve("."), paths },
    include: [],
    files: files.map((f) => resolve(f)),
  };
  await Bun.write(join(workDir, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
  return runTsc(join(workDir, "tsconfig.json"));
}

/**
 * Compiles EVERY consumer in one program, against one surface directory.
 *
 * One run per member rather than one per member per consumer. tsc reports each
 * error against the file it is in, and a consumer's files are under its own
 * directory, so one program's output says which consumers stopped compiling.
 * Separate runs would say the same thing and cost as many times as there are
 * consumers.
 */
type Consumers = {
  /** Consumer name to the files that compile it. */
  files: Record<string, string[]>;
  /**
   * Which consumer an error line belongs to, or null when no single one owns it.
   *
   * Null means the error is in a file no consumer owns, so nothing can say
   * whose use broke - and the caller then blames all of them, which is the
   * reading that cannot be wrong in the unsafe direction.
   */
  owner: (line: string) => string | null;
};

function blamed(output: string, consumers: Consumers): string[] {
  const names = Object.keys(consumers.files);
  const lines = output.split("\n").filter((l) => /error TS\d+/.test(l));
  const hit = new Set<string>();
  for (const line of lines) {
    const owner = consumers.owner(line);
    if (owner && names.includes(owner)) hit.add(owner);
    else return names;
  }
  return [...hit];
}

/** Runs the tasks a few at a time. tsc is a process each, so all at once is not free. */
async function inLanes<T, R>(items: T[], lanes: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(lanes, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await run(items[i]!);
    }),
  );
  return out;
}

/**
 * What each app uses, and what the surface provides.
 *
 * The SHELL is not asked. It is the provider: its conformance adapter says
 * `actual` is assignable to the contract, which a surface that SHRANK cannot
 * break, and its own code reaches `api.ts` by relative path rather than through
 * the specifier. Measured on 2026-08-29 - the shell's use set came back empty
 * for all eleven members - so probing it costs a fifth of the run for a column
 * of blanks.
 *
 * Two tsc runs per member: one to prove the cut surface still holds, one for
 * every consumer at once. The baseline is checked first, because a consumer
 * that does not compile against the WHOLE surface would fail every cut too and
 * read as using everything.
 */
export async function readMembers(surface: Surface, apps: Unit[]): Promise<MemberReading> {
  return probeMembers({
    name: "shell.d.ts",
    files: { "shell.d.ts": surface["shell.d.ts"], "subapp.d.ts": surface["subapp.d.ts"] },
    paths: (dir) => ({
      "@pointer/shell": [join(dir, "shell.d.ts")],
      "@pointer/subapp": [join(dir, "subapp.d.ts")],
      "@pointer/blocks": [resolve("src/server/blocks.ts")],
    }),
    consumers: {
      files: Object.fromEntries(apps.map((a) => [a, filesFor(a)])),
      owner: (line) => apps.find((a) => line.includes(`/apps/${a}/`)) ?? null,
    },
  });
}

/**
 * Which fields of the server-to-shell blocks the SHELL actually reads, §11.
 *
 * The same question as the contract's, one boundary out. The server writes
 * `__BUILD__`, `__APPS__` and `__VERSIONS__`; the shell reads part of them; and
 * the two are separate deploys, so "part" is the whole of what can be said
 * safely. A field the shell never reads can be renamed freely, and a field it
 * does read cannot be - which is the rule §11 had written in a comment.
 */
export async function readBlockMembers(): Promise<MemberReading> {
  const declaration = await emitBlocks();
  return probeMembers({
    name: "blocks.d.ts",
    files: { "blocks.d.ts": declaration },
    paths: (dir) => ({
      "@pointer/shell": [resolve("src/web/shell/api.ts")],
      "@pointer/subapp": [resolve("src/web/shell/subapp.ts")],
      "@pointer/blocks": [join(dir, "blocks.d.ts")],
    }),
    consumers: {
      files: { shell: filesFor("shell") },
      // One consumer, so every error is its own. The server is not asked: it
      // PRODUCES these blocks, and tsc already holds it to the declaration.
      owner: () => "shell",
    },
  });
}

type Spec = {
  /** The file the members are cut from. */
  name: string;
  /** Everything written into each scratch directory, by file name. */
  files: Record<string, string>;
  /** The specifier mapping a consumer compiles under, given that directory. */
  paths: (dir: string) => Record<string, string[]>;
  consumers: Consumers;
};

async function probeMembers(spec: Spec): Promise<MemberReading> {
  // Named after the surface, so two readings can run at once. The contract's
  // and the blocks' are independent and `build.ts` starts both together.
  const WORK = join(ROOT, spec.name.replace(/\W/g, "_"));
  await rm(WORK, { recursive: true, force: true });
  const started = Bun.nanoseconds();

  const names = Object.keys(spec.consumers.files);
  const all = [...new Set(Object.values(spec.consumers.files).flat())];

  const write = async (dir: string, text: string) => {
    await mkdir(dir, { recursive: true });
    for (const [file, body] of Object.entries(spec.files)) {
      await Bun.write(join(dir, file), file === spec.name ? text : body);
    }
  };

  const base = join(WORK, "full");
  await write(base, spec.files[spec.name]!);
  const baseline = await compileWith(all, spec.paths(resolve(base)), join(WORK, "baseline"));
  if (!baseline.ok) {
    await rm(WORK, { recursive: true, force: true });
    throw new Error(
      `the consumers do not compile against the surface at HEAD, so nothing can be ` +
        `said about which members they use:\n${baseline.output}`,
    );
  }

  const members = membersIn(spec.files[spec.name]!, spec.name);
  const dirOf = (m: Member) => join(WORK, `cut-${m.path.replace(/\./g, "_")}`);

  const uses: Record<string, Record<string, string>> = Object.fromEntries(
    names.map((n) => [n, {} as Record<string, string>]),
  );
  const structural: string[] = [];
  const provides: Record<string, string> = {};

  const answers = await inLanes(members, LANES, async (member) => {
    const dir = dirOf(member);
    await write(dir, cut(spec.files[spec.name]!, member));
    // A member whose removal breaks the surface itself cannot be asked about:
    // every consumer would fail for a reason that is not use.
    if (!(await surfaceHolds(dir, spec))) return { member, structural: true, users: [] as string[] };
    const result = await compileWith(
      all,
      spec.paths(resolve(dir)),
      join(WORK, `probe-${member.digest}`),
    );
    return { member, structural: false, users: result.ok ? [] : blamed(result.output, spec.consumers) };
  });

  for (const a of answers) {
    if (a.structural) {
      structural.push(a.member.path);
      continue;
    }
    provides[a.member.path] = a.member.digest;
    for (const name of a.users) uses[name]![a.member.path] = a.member.digest;
  }

  await rm(WORK, { recursive: true, force: true });

  return { provides, uses, structural, ms: Math.round((Bun.nanoseconds() - started) / 1e6) };
}

/** The table, for a person. */
export function renderMembers(reading: MemberReading, units: string[]): string {
  const paths = Object.keys(reading.provides).sort();
  const width = Math.max(8, ...paths.map((p) => p.length));
  const lines = [`${"member".padEnd(width)}  ${units.map((u) => u.slice(0, 7).padEnd(7)).join(" ")}`];
  for (const path of paths) {
    const row = units.map((u) => ((reading.uses[u] ?? {})[path] ? "uses   " : "       ")).join(" ");
    lines.push(`${path.padEnd(width)}  ${row}`);
  }
  if (reading.structural.length) {
    lines.push(`\nnot removable on their own: ${reading.structural.join(", ")}`);
  }
  return lines.join("\n");
}
