mod project_folder;
mod updates;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if updates::cli() {
        return;
    }
    tauri::Builder::default()
        .manage(updates::Updates::new())
        .manage(project_folder::Folders::default())
        .on_window_event(|window, event| {
            use tauri::{Emitter, Manager};
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.try_state::<updates::Updates>() {
                    if state.0.as_ref().is_ok_and(|u| {
                        matches!(
                            u.snapshot().phase.as_str(),
                            "downloading" | "verifying" | "armed" | "handoff"
                        )
                    }) {
                        api.prevent_close();
                        let _ = window.emit("updates-close-blocked", ());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            project_folder::project_folder_choose,
            project_folder::project_folder_read,
            project_folder::project_folder_write,
            updates::updates_snapshot,
            updates::updates_check,
            updates::updates_prepare,
            updates::updates_cancel,
            updates::updates_arm,
            updates::updates_finish
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o ArmaduraStruct");
}
