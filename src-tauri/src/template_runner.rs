// Backend commands for the Template Runner feature: picking an output
// folder, rendering evaluated node properties as YAML, writing that YAML to
// disk, and running the user-authored "run script" for a node.
//
// Security note: `tr_run_script` executes an arbitrary command string chosen
// by the user (via the Template Runner UI) with the same privileges as this
// application. This is intentional — it is a local automation/scaffolding
// tool, not a network service — but it means templates should only contain
// scripts the user trusts, the same way one would trust a personal build
// script or Excel macro.

use std::collections::HashMap;
use std::process::Command;
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
pub struct ScriptResult {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Decodes process output as UTF-8 when possible, falling back to Shift-JIS
/// (the default codepage for `cmd`/PowerShell on ja-JP Windows) so Japanese
/// script output doesn't get garbled.
fn decode_output(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (decoded, _, _) = encoding_rs::SHIFT_JIS.decode(bytes);
            decoded.into_owned()
        }
    }
}

#[tauri::command]
pub fn tr_pick_folder(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string())
}

#[tauri::command]
pub fn tr_render_yaml(value: serde_json::Value) -> Result<String, String> {
    serde_yaml::to_string(&value).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn tr_write_text_file(path: String, contents: String) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    std::fs::write(target, contents).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn tr_run_script(
    cwd: String,
    command: String,
    env: HashMap<String, String>,
) -> Result<ScriptResult, String> {
    if command.trim().is_empty() {
        return Err("ランスクリプトが空です".to_string());
    }

    std::fs::create_dir_all(&cwd).map_err(|err| err.to_string())?;

    let mut process = Command::new("cmd");
    process.arg("/C").arg(&command).current_dir(&cwd);
    for (key, value) in &env {
        process.env(key, value);
    }

    let output = process.output().map_err(|err| err.to_string())?;
    Ok(ScriptResult {
        ok: output.status.success(),
        exit_code: output.status.code(),
        stdout: decode_output(&output.stdout),
        stderr: decode_output(&output.stderr),
    })
}
