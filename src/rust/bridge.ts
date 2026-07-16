import { contributionLevel as tsContributionLevel, contributionRate as tsContributionRate } from "../domain/dateLogic";

type RustExports = {
  contribution_rate: (total: number, done: number) => number;
  contribution_level: (total: number, done: number) => 0 | 1 | 2 | 3;
};

let rustExports: RustExports | null = null;

function supportsWasmImport(): boolean {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined";
}

export async function initRustBridge(): Promise<void> {
  if (!supportsWasmImport()) {
    return;
  }

  try {
    const wasmEntry = "./pkg/todo_core_wasm.js";
    const mod = await import(/* @vite-ignore */ wasmEntry);
    await mod.default();
    rustExports = {
      contribution_rate: mod.contribution_rate,
      contribution_level: mod.contribution_level,
    };
  } catch {
    rustExports = null;
  }
}

export function contributionRateCore(total: number, done: number): number {
  if (rustExports) {
    return rustExports.contribution_rate(total, done);
  }
  return tsContributionRate(total, done);
}

export function contributionLevelCore(total: number, done: number): 0 | 1 | 2 | 3 {
  if (rustExports) {
    return rustExports.contribution_level(total, done);
  }
  return tsContributionLevel(total, done);
}

export function rustEngineLabel(): string {
  return rustExports ? "rust-wasm" : "typescript-fallback";
}
