import { contributionLevel as tsContributionLevel, contributionRate as tsContributionRate } from "../domain/dateLogic";
let rustExports = null;
function supportsWasmImport() {
    return typeof window !== "undefined" && typeof WebAssembly !== "undefined";
}
export async function initRustBridge() {
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
    }
    catch {
        rustExports = null;
    }
}
export function contributionRateCore(total, done) {
    if (rustExports) {
        return rustExports.contribution_rate(total, done);
    }
    return tsContributionRate(total, done);
}
export function contributionLevelCore(total, done) {
    if (rustExports) {
        return rustExports.contribution_level(total, done);
    }
    return tsContributionLevel(total, done);
}
export function rustEngineLabel() {
    return rustExports ? "rust-wasm" : "typescript-fallback";
}
