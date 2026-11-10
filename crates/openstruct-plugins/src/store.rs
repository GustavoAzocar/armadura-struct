use crate::{
    contract::{self, Compatibility, Host},
    package,
};
use anyhow::{ensure, Context, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub manifest: Value,
    pub sha256: String,
    pub size: u64,
    pub origin: String,
    pub installed_at: u64,
    pub trust: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub token: String,
    pub manifest: Value,
    pub sha256: String,
    pub size: u64,
    pub origin: String,
    pub compatibility: Compatibility,
    pub trust: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    #[serde(flatten)]
    pub record: Record,
    pub compatibility: Compatibility,
    pub status: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub outcome: &'static str,
    pub item: InventoryItem,
}
struct Pending {
    file: NamedTempFile,
    view: Inspection,
    created: Instant,
}
pub struct Service {
    pub(crate) root: PathBuf,
    pub(crate) host: Host,
    pending: Mutex<HashMap<String, Pending>>,
    pub(crate) offers: Mutex<HashMap<String, crate::online::Offer>>,
    pub(crate) operations: Mutex<HashMap<String, Arc<crate::online::Cancellation>>>,
}
pub(crate) fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    m.lock()
        .map_err(|_| anyhow::anyhow!("Serviço de plugins ocupado"))
}
fn regular(path: &Path) -> Result<()> {
    let m = fs::symlink_metadata(path)?;
    ensure!(
        m.is_file() && !m.file_type().is_symlink(),
        "Arquivo administrado inválido"
    );
    Ok(())
}
fn directory(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(m) => ensure!(
            m.is_dir() && !m.file_type().is_symlink(),
            "Diretório administrado inválido"
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => fs::create_dir(path)?,
        Err(e) => return Err(e.into()),
    }
    Ok(())
}
fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    let _ = path;
    Ok(())
}
impl Service {
    pub fn new(root: PathBuf, host: Host) -> Result<Self> {
        // Parent is the framework's per-user application-data directory.
        directory(&root)?;
        for p in ["installed", ".staging", ".trash"] {
            directory(&root.join(p))?;
        }
        Ok(Self {
            root,
            host,
            pending: Mutex::new(HashMap::new()),
            offers: Mutex::new(HashMap::new()),
            operations: Mutex::new(HashMap::new()),
        })
    }
    fn transaction(&self) -> Result<File> {
        directory(&self.root)?;
        for p in ["installed", ".staging", ".trash"] {
            directory(&self.root.join(p))?;
        }
        let path = self.root.join("inventory.lock");
        if path.exists() {
            regular(&path)?;
        }
        let f = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)?;
        f.try_lock_exclusive()
            .context("Outra operação de plugins está em andamento; tente novamente")?;
        Ok(f)
    }
    pub fn inspect_file(&self, file: &mut File, label: &str) -> Result<Inspection> {
        ensure!(
            file.metadata()?.is_file() && file.metadata()?.len() <= package::MAX_PACKAGE as u64,
            "Use um pacote de até 16 MiB"
        );
        let mut bytes = Vec::new();
        file.take(package::MAX_PACKAGE as u64 + 1)
            .read_to_end(&mut bytes)?;
        self.inspect_bytes(
            &bytes,
            format!(
                "Arquivo local: {}",
                label.chars().take(160).collect::<String>()
            ),
        )
    }
    pub fn inspect_bytes(&self, bytes: &[u8], origin: String) -> Result<Inspection> {
        let manifest = package::inspect(bytes)?;
        let view = Inspection {
            token: Uuid::new_v4().to_string(),
            compatibility: contract::compatibility(&manifest, &self.host),
            manifest,
            sha256: package::sha256(bytes),
            size: bytes.len() as u64,
            origin,
            trust: "integrity-only",
        };
        let mut pending = lock(&self.pending)?;
        pending.retain(|_, p| p.created.elapsed() < Duration::from_secs(600));
        ensure!(
            pending.len() < 4,
            "Feche uma inspeção antes de preparar outro pacote"
        );
        let mut file = NamedTempFile::new_in(self.root.join(".staging"))?;
        file.write_all(bytes)?;
        file.as_file().sync_all()?;
        pending.insert(
            view.token.clone(),
            Pending {
                file,
                view: view.clone(),
                created: Instant::now(),
            },
        );
        Ok(view)
    }
    pub fn discard(&self, token: &str) -> Result<()> {
        lock(&self.pending)?.remove(token);
        Ok(())
    }
    fn item(&self, record: Record) -> InventoryItem {
        let compatibility = contract::compatibility(&record.manifest, &self.host);
        let status = if !compatibility.platform_available {
            "platform-unavailable"
        } else if !compatibility.compatible {
            "incompatible"
        } else {
            "runtime-unsupported"
        };
        InventoryItem {
            record,
            compatibility,
            status,
        }
    }
    pub fn install(&self, token: &str) -> Result<InstallResult> {
        let _guard = self.transaction()?;
        let mut pending = lock(&self.pending)?
            .remove(token)
            .context("Inspeção expirada/cancelada; selecione o pacote novamente")?;
        ensure!(
            pending.created.elapsed() < Duration::from_secs(600),
            "Inspeção expirada"
        );
        ensure!(
            pending.view.compatibility.compatible,
            "Pacote incompatível; registro recusado"
        );
        pending.file.seek(SeekFrom::Start(0))?;
        let mut bytes = Vec::new();
        (&mut pending.file)
            .take(package::MAX_PACKAGE as u64 + 1)
            .read_to_end(&mut bytes)?;
        ensure!(
            package::sha256(&bytes) == pending.view.sha256
                && package::inspect(&bytes)? == pending.view.manifest,
            "Pacote mudou após a inspeção"
        );
        let m = &pending.view.manifest;
        let id = m["id"].as_str().unwrap();
        let version = m["version"].as_str().unwrap();
        let id_dir = self.root.join("installed").join(id);
        directory(&id_dir)?;
        let dest = id_dir.join(version);
        if fs::symlink_metadata(&dest).is_ok() {
            let old = self.read_record(&dest)?;
            ensure!(
                old.sha256 == pending.view.sha256,
                "Mesmo ID/versão com conteúdo diferente; não foi sobrescrito"
            );
            return Ok(InstallResult {
                outcome: "already-installed",
                item: self.item(old),
            });
        }
        ensure!(
            self.records_unlocked()?.len() < 256,
            "Limite de 256 versões instaladas"
        );
        let stage = tempfile::tempdir_in(self.root.join(".staging"))?;
        let record = Record {
            manifest: m.clone(),
            sha256: pending.view.sha256.clone(),
            size: bytes.len() as u64,
            origin: pending.view.origin,
            installed_at: SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
            trust: "integrity-only".into(),
            enabled: false,
        };
        let write = |name: &str, data: &[u8]| -> Result<()> {
            let mut f = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(stage.path().join(name))?;
            f.write_all(data)?;
            f.sync_all()?;
            Ok(())
        };
        write("package.osplugin", &bytes)?;
        write("record.json", &serde_json::to_vec(&record)?)?;
        sync_dir(stage.path())?;
        fs::rename(stage.path(), &dest)
            .context("Não foi possível concluir a instalação atômica")?;
        sync_dir(&id_dir)?;
        Ok(InstallResult {
            outcome: "installed",
            item: self.item(record),
        })
    }
    fn read_record(&self, path: &Path) -> Result<Record> {
        directory(path)?;
        regular(&path.join("record.json"))?;
        regular(&path.join("package.osplugin"))?;
        let mut bytes = Vec::new();
        File::open(path.join("record.json"))?
            .take(256 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        ensure!(bytes.len() <= 256 * 1024, "Registro muito grande");
        let record: Record = serde_json::from_value(contract::parse_json(&bytes)?)?;
        contract::validate_manifest(&record.manifest)?;
        ensure!(
            !record.enabled && record.trust == "integrity-only",
            "Estado de execução não reconhecido"
        );
        ensure!(
            path.file_name().and_then(|s| s.to_str()) == record.manifest["version"].as_str()
                && path
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|s| s.to_str())
                    == record.manifest["id"].as_str(),
            "Identidade do registro divergente"
        );
        let mut data = Vec::new();
        File::open(path.join("package.osplugin"))?
            .take(package::MAX_PACKAGE as u64 + 1)
            .read_to_end(&mut data)?;
        ensure!(
            data.len() as u64 == record.size
                && package::sha256(&data) == record.sha256
                && package::inspect(&data)? == record.manifest,
            "Integridade do pacote instalado divergente"
        );
        Ok(record)
    }
    fn records_unlocked(&self) -> Result<Vec<Record>> {
        let mut out = Vec::new();
        for id in fs::read_dir(self.root.join("installed"))? {
            let id = id?;
            ensure!(
                id.file_type()?.is_dir() && !id.file_type()?.is_symlink(),
                "Inventário contém caminho inválido"
            );
            for version in fs::read_dir(id.path())? {
                ensure!(out.len() < 256, "Inventário excede limite");
                out.push(self.read_record(&version?.path())?);
            }
        }
        out.sort_by(|a, b| {
            (
                a.manifest["id"].to_string(),
                a.manifest["version"].to_string(),
            )
                .cmp(&(
                    b.manifest["id"].to_string(),
                    b.manifest["version"].to_string(),
                ))
        });
        Ok(out)
    }
    pub fn list(&self) -> Result<Vec<InventoryItem>> {
        let _guard = self.transaction()?;
        Ok(self
            .records_unlocked()?
            .into_iter()
            .map(|r| self.item(r))
            .collect())
    }
    pub fn remove(&self, id: &str, version: &str) -> Result<()> {
        let _guard = self.transaction()?;
        // UI supplies identity only. Resolve it against validated committed records.
        let records = self.records_unlocked()?;
        let record = records
            .iter()
            .find(|r| r.manifest["id"] == id && r.manifest["version"] == version)
            .context("Plugin/versão não instalado")?;
        let source = self
            .root
            .join("installed")
            .join(record.manifest["id"].as_str().unwrap())
            .join(record.manifest["version"].as_str().unwrap());
        let trash = self.root.join(".trash").join(Uuid::new_v4().to_string());
        fs::rename(&source, &trash)?;
        sync_dir(source.parent().unwrap())?;
        // A crash here leaves only inert garbage, never an installed half-record.
        let _ = fs::remove_dir_all(&trash);
        Ok(())
    }
}
