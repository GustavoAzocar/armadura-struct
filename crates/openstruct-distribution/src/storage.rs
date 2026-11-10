use anyhow::{ensure, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path.parent().context("Pasta de estado inválida")?;
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut file, value)?;
    file.write_all(b"\n")?;
    file.as_file().sync_all()?;
    file.persist(path)
        .map_err(|e| e.error)
        .context("Não foi possível salvar o estado")?;
    Ok(())
}

pub fn digest(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn managed_app_dir(root: &Path, id: &str) -> Result<PathBuf> {
    ensure!(
        crate::model::valid_id(id),
        "Identificador de aplicativo inválido"
    );
    fs::create_dir_all(root)?;
    let canonical = dunce::canonicalize(root)?;
    let app = canonical.join(id);
    ensure!(
        !fs::symlink_metadata(&app)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false),
        "A pasta do aplicativo não pode ser um link simbólico"
    );
    if app.exists() {
        ensure!(app.is_dir(), "A pasta do aplicativo é inválida");
    }
    Ok(app)
}

pub fn reject_symlink(path: &Path) -> Result<()> {
    ensure!(
        !fs::symlink_metadata(path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false),
        "Caminho gerenciado não pode ser um link simbólico"
    );
    Ok(())
}

pub fn default_install_root() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("OpenStruct")
        .join("apps")
}

pub fn acquire_lock(data_dir: &Path) -> Result<File> {
    fs::create_dir_all(data_dir)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(data_dir.join("launcher.lock"))?;
    fs2::FileExt::try_lock_exclusive(&file).context("O Struct Launcher já está em execução")?;
    Ok(file)
}
