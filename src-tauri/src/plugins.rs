//! Narrow IPC adapter: native picker and opaque tokens, never UI-provided paths.
use openstruct_plugins::{
    contract::Host,
    online::CatalogView,
    store::{Inspection, InstallResult, InventoryItem},
    Service,
};
use std::{
    fs,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct Plugins(Mutex<Option<Arc<Service>>>);
impl Plugins {
    fn service(&self, window: &WebviewWindow) -> Result<Arc<Service>, String> {
        if window.label() != "main" {
            return Err("Janela não autorizada".into());
        }
        let mut state = self.0.lock().map_err(message)?;
        if let Some(service) = state.as_ref() {
            return Ok(service.clone());
        }
        let parent = window.app_handle().path().app_data_dir().map_err(message)?;
        fs::create_dir_all(&parent).map_err(message)?;
        let service = Arc::new(
            Service::new(
                parent.join("plugins-v1"),
                Host {
                    app_version: env!("CARGO_PKG_VERSION").into(),
                    platform: match std::env::consts::OS {
                        "windows" => "windows",
                        "macos" => "macos",
                        _ => "linux",
                    }
                    .into(),
                    architecture: std::env::consts::ARCH.into(),
                },
            )
            .map_err(message)?,
        );
        *state = Some(service.clone());
        Ok(service)
    }
}
fn message(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[tauri::command]
pub async fn plugins_pick(
    window: WebviewWindow,
    state: State<'_, Plugins>,
) -> Result<Option<Inspection>, String> {
    let service = state.service(&window)?;
    let picker = window
        .app_handle()
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Inspecionar pacote de plugin")
        .add_filter("Plugin OpenStruct", &["osplugin"]);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = picker.blocking_pick_file() else {
            return Ok(None);
        };
        let path = file.into_path().map_err(message)?;
        let label = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("pacote.osplugin");
        let mut file = fs::File::open(&path).map_err(message)?;
        service
            .inspect_file(&mut file, label)
            .map(Some)
            .map_err(message)
    })
    .await
    .map_err(message)?
}
#[tauri::command]
pub async fn plugins_list(
    window: WebviewWindow,
    state: State<'_, Plugins>,
) -> Result<Vec<InventoryItem>, String> {
    let service = state.service(&window)?;
    tauri::async_runtime::spawn_blocking(move || service.list().map_err(message))
        .await
        .map_err(message)?
}
#[tauri::command]
pub async fn plugins_install(
    window: WebviewWindow,
    state: State<'_, Plugins>,
    token: String,
) -> Result<InstallResult, String> {
    let service = state.service(&window)?;
    tauri::async_runtime::spawn_blocking(move || service.install(&token).map_err(message))
        .await
        .map_err(message)?
}
#[tauri::command]
pub async fn plugins_remove(
    window: WebviewWindow,
    state: State<'_, Plugins>,
    id: String,
    version: String,
) -> Result<(), String> {
    let service = state.service(&window)?;
    tauri::async_runtime::spawn_blocking(move || service.remove(&id, &version).map_err(message))
        .await
        .map_err(message)?
}
#[tauri::command]
pub fn plugins_discard(
    window: WebviewWindow,
    state: State<'_, Plugins>,
    token: String,
) -> Result<(), String> {
    state.service(&window)?.discard(&token).map_err(message)
}
#[tauri::command]
pub async fn plugins_catalog(
    window: WebviewWindow,
    state: State<'_, Plugins>,
    source: String,
    operation_id: String,
) -> Result<CatalogView, String> {
    state
        .service(&window)?
        .catalog(&source, &operation_id)
        .await
        .map_err(message)
}
#[tauri::command]
pub async fn plugins_download(
    window: WebviewWindow,
    state: State<'_, Plugins>,
    offer_id: String,
    operation_id: String,
) -> Result<Inspection, String> {
    state
        .service(&window)?
        .prepare_online(&offer_id, &operation_id)
        .await
        .map_err(message)
}
#[tauri::command]
pub fn plugins_cancel(
    window: WebviewWindow,
    state: State<'_, Plugins>,
    operation_id: String,
) -> Result<(), String> {
    state
        .service(&window)?
        .cancel(&operation_id)
        .map_err(message)
}
