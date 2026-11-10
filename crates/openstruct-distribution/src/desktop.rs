use crate::{model::Installed, storage::reject_symlink};
use anyhow::{ensure, Context, Result};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
fn target(data: &Path, item: &Installed) -> PathBuf {
    data.join("applications")
        .join(format!("openstruct-{}.desktop", item.app_id))
}
pub fn write_app_shortcut(data: &Path, item: &Installed) -> Result<()> {
    let path = target(data, item);
    reject_symlink(&path)?;
    // Existing icon, name and menu metadata remain owned by the Launcher.
    let text =
        fs::read_to_string(&path).context("Atalho ausente; abra o Launcher para restaurá-lo")?;
    ensure!(
        text.contains("X-OpenStruct-Managed=true")
            && text.contains(&format!("X-OpenStruct-Root={}\n", item.root)),
        "Atalho pertence a outra instalação"
    );
    let escaped = item
        .executable
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
        .replace('$', "\\$")
        .replace('%', "%%");
    let next = text
        .lines()
        .map(|line| {
            if line.starts_with("Exec=") {
                format!("Exec=\"{escaped}\"")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    tmp.write_all(next.as_bytes())?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}
pub fn remove_app_shortcut(data: &Path, item: &Installed) -> Result<()> {
    let path = target(data, item);
    reject_symlink(&path)?;
    if fs::read_to_string(&path).is_ok_and(|s| {
        s.contains("X-OpenStruct-Managed=true")
            && s.contains(&format!("X-OpenStruct-Root={}\n", item.root))
    }) {
        fs::remove_file(path)?;
    }
    Ok(())
}
