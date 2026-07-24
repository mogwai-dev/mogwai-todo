use tauri::Manager;

mod template_runner;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            template_runner::tr_pick_folder,
            template_runner::tr_render_yaml,
            template_runner::tr_write_text_file,
            template_runner::tr_run_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Todo Desktop");
}
