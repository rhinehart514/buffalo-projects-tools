import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedOutput = process.argv[2];
const outputPath = resolve(
  requestedOutput ?? join(repositoryRoot, "artifacts", "buffalo-apply.mcpb"),
);
const stagingDirectory = await mkdtemp(join(tmpdir(), "buffalo-apply-mcpb-"));

try {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(join(repositoryRoot, "mcpb", "manifest.json"), "utf8"),
  );

  if (manifest.version !== packageJson.version) {
    throw new Error(
      `MCPB manifest version ${manifest.version} does not match package version ${packageJson.version}.`,
    );
  }

  await mkdir(join(stagingDirectory, "server"), { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });

  await Promise.all([
    copyFile(
      join(repositoryRoot, "dist", "index.js"),
      join(stagingDirectory, "server", "index.js"),
    ),
    copyFile(
      join(repositoryRoot, "mcpb", "manifest.json"),
      join(stagingDirectory, "manifest.json"),
    ),
    copyFile(
      join(repositoryRoot, "README.md"),
      join(stagingDirectory, "README.md"),
    ),
    copyFile(
      join(repositoryRoot, "LICENSE"),
      join(stagingDirectory, "LICENSE"),
    ),
  ]);

  await writeFile(
    join(stagingDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: packageJson.name,
        version: packageJson.version,
        private: true,
        type: "module",
        engines: packageJson.engines,
        dependencies: packageJson.dependencies,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  execFileSync(
    "npm",
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ],
    { cwd: stagingDirectory, stdio: "inherit" },
  );

  execFileSync(
    "pnpm",
    ["exec", "mcpb", "pack", stagingDirectory, outputPath],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  process.stdout.write(`${outputPath}\n`);
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
