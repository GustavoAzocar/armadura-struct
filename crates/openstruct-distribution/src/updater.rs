//! Consent-based product updates. No frontend-supplied URL, command or executable path.
use crate::{
    model::{Catalog, DiskState, Envelope, Installed, Package, Release, Trust, VERSION},
    platform, storage,
};
use anyhow::{bail, ensure, Context, Result};
use chrono::Utc;
use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::io::AsyncWriteExt;

pub const MAX_CATALOG: usize = 3_000_000;
const PRODUCT: &str = "armadurastruct";
const IDENTIFIER: &str = "com.openstruct.armadurastruct";
const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/ricardocorsini/openstruct-catalog/main/catalog.signed.json";

pub fn trust() -> Result<Trust> {
    Ok(serde_json::from_str(include_str!("../trust.json"))?)
}
pub fn bundled() -> Result<Envelope> {
    Ok(serde_json::from_str(include_str!(
        "../catalog.signed.json"
    ))?)
}
fn limited_json<T: serde::de::DeserializeOwned>(path: &Path, limit: u64) -> Result<T> {
    storage::reject_symlink(path)?;
    ensure!(
        fs::metadata(path)?.len() <= limit,
        "Arquivo local excede o limite"
    );
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
fn private_dir(path: &Path) -> Result<()> {
    storage::reject_symlink(path)?;
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
pub fn data_root() -> Result<PathBuf> {
    Ok(dirs::data_local_dir()
        .context("Pasta local indisponível")?
        .join(IDENTIFIER)
        .join("updates-v1"))
}
fn launcher_data() -> Result<PathBuf> {
    // Tauri app_data_dir: $XDG_DATA_HOME/<identifier>, %APPDATA%/<identifier>.
    Ok(dirs::data_dir()
        .context("Dados do Launcher indisponíveis")?
        .join("com.openstruct.launcher"))
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Installation {
    pub mode: String,
    pub executable: PathBuf,
    pub managed_root: Option<PathBuf>,
}
impl Installation {
    pub fn installable(&self) -> bool {
        matches!(self.mode.as_str(), "managed" | "appimage" | "nsis")
    }
    pub fn detect(development: bool) -> Result<Self> {
        let current = dunce::canonicalize(std::env::current_exe()?)?;
        let executable = current.clone();
        #[cfg(target_os = "linux")]
        let executable = match (std::env::var_os("APPIMAGE"), std::env::var_os("APPDIR")) {
            (Some(image), Some(appdir))
                if dunce::canonicalize(&appdir).is_ok_and(|dir| current.starts_with(dir)) =>
            {
                dunce::canonicalize(image)?
            }
            _ => executable,
        };
        let mut mode = "system".to_owned();
        let mut managed_root = None;
        if !development {
            for ancestor in executable.ancestors().skip(1).take(3) {
                let marker = ancestor.join(".openstruct-managed.json");
                if marker.exists() {
                    let owner: serde_json::Value = limited_json(&marker, 4096)?;
                    ensure!(
                        owner["schemaVersion"] == 1 && owner["appId"] == PRODUCT,
                        "Identidade da instalação gerenciada inválida"
                    );
                    ensure!(
                        ancestor.file_name().is_some_and(|n| n == PRODUCT),
                        "Pasta gerenciada inválida"
                    );
                    managed_root = Some(ancestor.parent().context("Raiz inválida")?.to_path_buf());
                    mode = "managed".into();
                    break;
                }
            }
            if mode != "managed" {
                #[cfg(target_os = "linux")]
                if executable != current && !system_path(&executable) {
                    verify_appimage(&executable)?;
                    mode = "appimage".into();
                }
                #[cfg(target_os = "windows")]
                if registered_nsis(&executable)? {
                    mode = "nsis".into();
                }
            }
        } else {
            mode = "development".into();
        }
        Ok(Self {
            mode,
            executable,
            managed_root,
        })
    }
    pub fn guidance(&self) -> String {
        match self.mode.as_str() {
        "managed"=>"Instalação gerenciada. Feche o Struct Launcher antes de instalar; seu inventário e atalhos serão preservados.".into(),
        "appimage"=>"AppImage independente. A atualização preserva o caminho e mantém uma cópia anterior para recuperação.".into(),
        "nsis"=>"Instalação NSIS por usuário. O aplicativo será fechado para executar o instalador e reiniciado para confirmar a versão.".into(),
        "development"=>"Build de desenvolvimento: consulta disponível, instalação nativa desabilitada.".into(),
        _=>"Formato não reconhecido ou instalação de sistema. Atualize pelo mesmo gerenciador/método usado na instalação.".into()
    }
    }
}
fn system_path(path: &Path) -> bool {
    ["/usr", "/opt", "/snap", "/nix", "/var/lib"]
        .iter()
        .any(|p| path.starts_with(p))
}
fn verify_appimage(path: &Path) -> Result<()> {
    use std::io::Read;
    let mut h = [0u8; 11];
    File::open(path)?.read_exact(&mut h)?;
    ensure!(
        &h[..4] == b"\x7fELF" && &h[8..11] == b"AI\x02",
        "Arquivo não é um AppImage tipo 2"
    );
    Ok(())
}
#[cfg(target_os = "windows")]
fn registered_nsis(executable: &Path) -> Result<bool> {
    use winreg::{enums::*, RegKey};
    let executable = dunce::canonicalize(executable)?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(keys) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall")
    else {
        return Ok(false);
    };
    for key in keys.enum_keys().flatten() {
        let Ok(k) = keys.open_subkey(key) else {
            continue;
        };
        let name: String = k.get_value("DisplayName").unwrap_or_default();
        let location: String = k.get_value("InstallLocation").unwrap_or_default();
        // Tauri NSIS stores InstallLocation surrounded by a pair of quotes.
        let location = location
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .unwrap_or(&location);
        if name == "ArmaduraStruct"
            && !location.is_empty()
            && dunce::canonicalize(location).ok().as_deref() == executable.parent()
            && Path::new(&location).join("uninstall.exe").is_file()
        {
            return Ok(true);
        }
    }
    Ok(false)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub version: String,
    pub notes: String,
    pub size: u64,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub current_version: String,
    pub mode: String,
    pub status: String,
    pub message: String,
    pub checked_at: Option<String>,
    pub offer: Option<Offer>,
    pub phase: String,
    pub received: u64,
    pub total: u64,
    pub receipt: Option<String>,
}
#[derive(Clone, Debug)]
pub struct Selection {
    pub version: String,
    pub release: Release,
    pub package: Package,
}
pub fn select(
    catalog: &Catalog,
    running: &str,
    os: &str,
    arch: &str,
    channel: &str,
) -> Result<Option<Selection>> {
    let installed = Version::parse(running).context("Versão em execução desconhecida")?;
    let mut candidates = catalog
        .product(PRODUCT)?
        .releases
        .iter()
        .filter(|r| r.channel == channel)
        .collect::<Vec<_>>();
    candidates.sort_by_cached_key(|r| std::cmp::Reverse(Version::parse(&r.version).ok()));
    let mut newer = false;
    for r in candidates {
        let v = Version::parse(&r.version)?;
        if (channel == "stable" && !v.pre.is_empty()) || v.cmp_precedence(&installed).is_le() {
            continue;
        }
        newer = true;
        if let Some(p) = r.assets.iter().find(|p| {
            p.platform == os
                && p.arch == arch
                && matches!(
                    (os, p.kind.as_str()),
                    ("linux", "appimage") | ("windows", "nsis")
                )
        }) {
            ensure!(
                p.key_id != "catalog-v1",
                "Chave de catálogo não pode assinar pacotes"
            );
            ensure!(
                Version::parse(VERSION)?
                    .cmp_precedence(&Version::parse(&p.min_launcher_version)?)
                    .is_ge(),
                "Este pacote exige um núcleo de distribuição mais novo; atualize pelo Launcher"
            );
            return Ok(Some(Selection {
                version: r.version.clone(),
                release: r.clone(),
                package: p.clone(),
            }));
        }
    }
    ensure!(
        !newer,
        "Há versão superior, mas não há pacote compatível com este sistema e arquitetura"
    );
    Ok(None)
}
fn same_selection(a: &Selection, b: &Selection) -> Result<()> {
    ensure!(
        a.version == b.version
            && serde_json::to_value(&a.package)? == serde_json::to_value(&b.package)?,
        "A versão ou pacote disponível mudou. Verifique novamente antes de instalar"
    );
    Ok(())
}
pub fn accept_catalog(trust: &Trust, envelope: &Envelope, previous: &Envelope) -> Result<Catalog> {
    ensure!(
        envelope.key_id == "catalog-v1" && previous.key_id == "catalog-v1",
        "A assinatura de catálogo exige a chave exclusiva de catálogo"
    );
    let old = trust.open_envelope(previous)?;
    let next = trust.open_envelope(envelope)?;
    ensure!(
        chrono::DateTime::parse_from_rfc3339(&next.published_at)?
            >= chrono::DateTime::parse_from_rfc3339(&old.published_at)?,
        "Catálogo anterior ao já conhecido foi recusado"
    );
    Ok(next)
}
fn client(trust: &Trust, timeout: u64) -> Result<reqwest::Client> {
    let trust = trust.clone();
    Ok(reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(timeout))
        .user_agent(format!("OpenStruct-Distribution/{VERSION}"))
        .redirect(reqwest::redirect::Policy::custom(move |a| {
            if a.previous().len() >= 5 || trust.check_url(a.url().as_str()).is_err() {
                a.error("Redirecionamento não autorizado")
            } else {
                a.follow()
            }
        }))
        .build()?)
}
async fn fetch(trust: &Trust) -> Result<Envelope> {
    trust.check_url(CATALOG_URL)?;
    let response = client(trust, 20)?.get(CATALOG_URL).send().await?;
    envelope_response(response).await
}
async fn envelope_response(response: reqwest::Response) -> Result<Envelope> {
    let response = response.error_for_status()?;
    ensure!(
        response.content_length().unwrap_or(0) <= MAX_CATALOG as u64,
        "Catálogo excede limite"
    );
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        ensure!(
            body.len() + chunk.len() <= MAX_CATALOG,
            "Catálogo excede limite"
        );
        body.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u32,
    product: String,
    version: String,
    previous_version: String,
    installation: Installation,
    envelope: Envelope,
    nonce: String,
    previous_digest: String,
}
struct Staged {
    dir: PathBuf,
    request: Request,
    _lock: File,
}
struct State {
    snapshot: Snapshot,
    selection: Option<Selection>,
    staged: Option<Staged>,
}
pub struct Updater {
    root: PathBuf,
    installation: Installation,
    running: String,
    trust: Trust,
    state: Mutex<State>,
    operation: tokio::sync::Mutex<()>,
    cancel: AtomicBool,
}
impl Updater {
    pub fn new(root: PathBuf, installation: Installation, running: String) -> Result<Arc<Self>> {
        private_dir(&root)?;
        Version::parse(&running)?;
        let receipt = read_receipt(&root, &running, &installation.executable);
        Ok(Arc::new(Self {
            root,
            installation: installation.clone(),
            running: running.clone(),
            trust: trust()?,
            state: Mutex::new(State {
                snapshot: Snapshot {
                    revision: 0,
                    current_version: running,
                    mode: installation.mode.clone(),
                    status: "idle".into(),
                    message: installation.guidance(),
                    checked_at: None,
                    offer: None,
                    phase: "idle".into(),
                    received: 0,
                    total: 0,
                    receipt,
                },
                selection: None,
                staged: None,
            }),
            operation: tokio::sync::Mutex::new(()),
            cancel: AtomicBool::new(false),
        }))
    }
    pub fn snapshot(&self) -> Snapshot {
        self.state.lock().unwrap().snapshot.clone()
    }
    fn change(&self, f: impl FnOnce(&mut Snapshot)) {
        let mut s = self.state.lock().unwrap();
        s.snapshot.revision += 1;
        f(&mut s.snapshot);
    }
    fn lock(&self) -> Result<File> {
        let p = self.root.join("updater.lock");
        storage::reject_symlink(&p)?;
        let f = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(p)?;
        fs2::FileExt::try_lock_exclusive(&f).context("Há outra atualização em andamento")?;
        Ok(f)
    }
    fn previous(&self) -> Result<Envelope> {
        let shipped = bundled()?;
        self.trust.open_envelope(&shipped)?;
        let p = self.root.join("catalog-cache.json");
        if !p.exists() {
            return Ok(shipped);
        }
        let cached: Result<Envelope> = limited_json(&p, MAX_CATALOG as u64);
        match cached {
            Ok(cached) if accept_catalog(&self.trust, &cached, &shipped).is_ok() => Ok(cached),
            _ => Ok(shipped),
        }
    }
    async fn latest(&self) -> Result<(Envelope, Catalog)> {
        let previous = self.previous()?;
        let e = fetch(&self.trust).await?;
        let c = accept_catalog(&self.trust, &e, &previous)?;
        storage::atomic_json(&self.root.join("catalog-cache.json"), &e)?;
        Ok((e, c))
    }
    pub async fn check(&self) -> Snapshot {
        let Ok(_operation) = self.operation.try_lock() else {
            return self.snapshot();
        };
        if self.state.lock().unwrap().staged.is_some() {
            return self.snapshot();
        }
        self.change(|s| {
            s.status = "checking".into();
            s.message = "Consultando catálogo oficial…".into();
        });
        let result = async {
            let _lock = self.lock()?;
            let (_, c) = self.latest().await?;
            select(
                &c,
                &self.running,
                std::env::consts::OS,
                std::env::consts::ARCH,
                "stable",
            )
        }
        .await;
        match result {
            Ok(selection) => {
                let offer = selection.as_ref().map(|s| Offer {
                    version: s.version.clone(),
                    notes: s.release.notes.clone(),
                    size: s.package.size,
                    kind: s.package.kind.clone(),
                });
                self.state.lock().unwrap().selection = selection;
                self.change(|s| {
                    s.status = if offer.is_some() {
                        "available"
                    } else {
                        "current"
                    }
                    .into();
                    s.message = if offer.is_some() {
                        self.installation.guidance()
                    } else {
                        "A versão em execução está atualizada no canal estável.".into()
                    };
                    s.offer = offer;
                    s.checked_at = Some(Utc::now().to_rfc3339());
                });
            }
            Err(e) => {
                let msg = format!("{e:#}");
                let status = if msg.contains("não há pacote compatível") {
                    "unsupported"
                } else if e
                    .downcast_ref::<reqwest::Error>()
                    .is_some_and(|e| e.is_connect())
                {
                    "offline"
                } else {
                    "error"
                };
                self.change(|s| {
                    s.status = status.into();
                    s.message = msg;
                    s.offer = None;
                });
                self.state.lock().unwrap().selection = None;
            }
        }
        self.snapshot()
    }
    pub fn cancel(&self) -> Result<Snapshot> {
        self.cancel.store(true, Ordering::Relaxed);
        if let Ok(_op) = self.operation.try_lock() {
            if let Some(stage) = self.state.lock().unwrap().staged.take() {
                cleanup(&stage.dir);
            }
            self.change(|s| {
                s.phase = "cancelled".into();
                s.received = 0;
                s.total = 0;
            });
        }
        Ok(self.snapshot())
    }
    pub async fn prepare(&self, version: &str) -> Result<Snapshot> {
        let _op = self
            .operation
            .try_lock()
            .map_err(|_| anyhow::anyhow!("Operação já em andamento"))?;
        ensure!(
            self.installation.installable(),
            "{}",
            self.installation.guidance()
        );
        ensure!(
            self.state.lock().unwrap().staged.is_none(),
            "Download já preparado"
        );
        let expected = self
            .state
            .lock()
            .unwrap()
            .selection
            .clone()
            .context("Verifique atualizações primeiro")?;
        ensure!(
            expected.version == version,
            "Versão não corresponde à oferta apresentada"
        );
        self.cancel.store(false, Ordering::Relaxed);
        let lock = self.lock()?;
        for entry in fs::read_dir(&self.root)?.flatten() {
            let path = entry.path();
            if !entry.file_type()?.is_dir()
                || !entry.file_name().to_string_lossy().starts_with("stage-")
            {
                continue;
            }
            if let Ok(owner) =
                limited_json::<serde_json::Value>(&path.join("stage-owner.json"), 4096)
            {
                if owner["schemaVersion"] == 1 && owner["product"] == PRODUCT {
                    cleanup(&path);
                }
            }
        }
        let (envelope, catalog) = self.latest().await?;
        let fresh = select(
            &catalog,
            &self.running,
            std::env::consts::OS,
            std::env::consts::ARCH,
            "stable",
        )?
        .context("Atualização não disponível")?;
        same_selection(&expected, &fresh)?;
        self.validate_installation()?;
        let previous_digest = storage::digest(&self.installation.executable)?;
        let margin = 16_000_000;
        let helper_size = fs::metadata(std::env::current_exe()?)?.len();
        ensure!(
            fs2::available_space(&self.root)? > fresh.package.size + helper_size + margin,
            "Não há espaço livre suficiente para baixar e preparar a atualização"
        );
        ensure!(
            fs2::available_space(
                self.installation
                    .executable
                    .parent()
                    .context("Pasta inválida")?
            )? > fresh.package.size.saturating_mul(3)
                + fs::metadata(&self.installation.executable)?.len()
                + margin,
            "Não há espaço livre suficiente para instalar e preservar a versão atual"
        );
        let dir = self.root.join(format!("stage-{}", uuid::Uuid::new_v4()));
        private_dir(&dir)?;
        storage::atomic_json(
            &dir.join("stage-owner.json"),
            &serde_json::json!({"schemaVersion":1,"product":PRODUCT}),
        )?;
        write_receipt(
            &self.root,
            version,
            &self.installation.executable,
            "downloading",
            "Download iniciado; uma interrupção exige nova tentativa, sem instalação automática",
        )?;
        self.change(|s| {
            s.phase = "downloading".into();
            s.received = 0;
            s.total = fresh.package.size;
            s.message = "Baixando a versão escolhida…".into();
        });
        let result = async {
            self.download(&fresh.package, &dir.join(package_name()))
                .await?;
            self.change(|s| {
                s.phase = "verifying".into();
                s.message = "Verificando tamanho, hash e assinatura…".into();
            });
            verify_package(
                &self.trust,
                &fresh.package,
                version,
                &dir.join(package_name()),
            )?;
            ensure!(!self.cancel.load(Ordering::Relaxed), "Download cancelado");
            let helper = dir.join(helper_name());
            fs::copy(std::env::current_exe()?, &helper)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&helper, fs::Permissions::from_mode(0o700))?;
            }
            let request = Request {
                schema_version: 1,
                product: PRODUCT.into(),
                version: version.into(),
                previous_version: self.running.clone(),
                installation: self.installation.clone(),
                envelope,
                nonce: uuid::Uuid::new_v4().to_string(),
                previous_digest,
            };
            storage::atomic_json(&dir.join("request.json"), &request)?;
            Ok::<_, anyhow::Error>(request)
        }
        .await;
        match result {
            Ok(request) => {
                self.state.lock().unwrap().staged = Some(Staged {
                    dir,
                    request,
                    _lock: lock,
                });
                let _ = write_receipt(
                    &self.root,
                    version,
                    &self.installation.executable,
                    "ready",
                    "Pacote preparado; a instalação ainda não foi iniciada",
                );
                self.change(|s| {
                    s.phase = "ready".into();
                    s.message = "Pacote verificado. Instalar e reiniciar exige confirmação.".into();
                });
                Ok(self.snapshot())
            }
            Err(e) => {
                cleanup(&dir);
                self.change(|s| {
                    s.phase = if self.cancel.load(Ordering::Relaxed) {
                        "cancelled"
                    } else {
                        "failed"
                    }
                    .into();
                    s.message = format!("{e:#}");
                });
                Err(e)
            }
        }
    }
    fn validate_installation(&self) -> Result<()> {
        validate_destination(&self.installation)?;
        if self.installation.mode == "managed" {
            let data = launcher_data()?;
            let _lock = storage::acquire_lock(&data)?;
            let disk: DiskState = limited_json(&data.join("state.json"), 5_000_000)?;
            managed_item(&disk, &self.installation, &self.running)?;
            ensure!(
                !disk.jobs.iter().any(|j| crate::model::is_active(&j.phase)),
                "O Launcher tem operações pendentes; conclua-as antes de atualizar"
            );
        }
        Ok(())
    }
    pub async fn arm(&self, version: &str) -> Result<Snapshot> {
        let _op = self
            .operation
            .try_lock()
            .map_err(|_| anyhow::anyhow!("Operação já em andamento"))?;
        let request = {
            let state = self.state.lock().unwrap();
            ensure!(
                state.snapshot.phase == "ready",
                "A confirmação da instalação já está em andamento"
            );
            let stage = state
                .staged
                .as_ref()
                .context("Baixe e verifique o pacote primeiro")?;
            ensure!(
                stage.request.version == version,
                "Versão não corresponde ao pacote preparado"
            );
            stage.request.clone()
        };
        let (_, cat) = self.latest().await?;
        let selected = select(
            &cat,
            &self.running,
            std::env::consts::OS,
            std::env::consts::ARCH,
            "stable",
        )?
        .context("Atualização não disponível")?;
        let original = self.trust.open_envelope(&request.envelope)?;
        let expected = select(
            &original,
            &self.running,
            std::env::consts::OS,
            std::env::consts::ARCH,
            "stable",
        )?
        .context("Oferta inválida")?;
        same_selection(&expected, &selected)?;
        self.validate_installation()?;
        let dir = self
            .state
            .lock()
            .unwrap()
            .staged
            .as_ref()
            .unwrap()
            .dir
            .clone();
        verify_package(
            &self.trust,
            &selected.package,
            version,
            &dir.join(package_name()),
        )?;
        ensure!(
            storage::digest(&self.installation.executable)? == request.previous_digest,
            "A instalação foi alterada externamente; reinicie a verificação"
        );
        confirm_product(&self.installation.executable, &self.running)?;
        let ready = dir.join("ready");
        storage::reject_symlink(&ready)?;
        if ready.exists() {
            fs::remove_file(&ready)?;
        }
        let mut command = Command::new(dir.join(helper_name()));
        command
            .arg("--openstruct-update-helper")
            .arg(dir.join("request.json"))
            .env_remove("APPIMAGE")
            .env_remove("APPDIR")
            .env_remove("ARGV0");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .context("Não foi possível iniciar o assistente de atualização")?;
        for _ in 0..100 {
            if fs::read_to_string(&ready).is_ok_and(|s| s == request.nonce) {
                self.change(|s| s.phase = "armed".into());
                return Ok(self.snapshot());
            }
            if child.try_wait()?.is_some() {
                bail!("O assistente encerrou antes de preparar a instalação")
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let _ = child.kill();
        bail!("O assistente não confirmou sua inicialização. Nada foi instalado")
    }
    pub fn authorize_exit(&self, version: &str) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let staged = state.staged.as_ref().context("Pacote não preparado")?;
        ensure!(
            state.snapshot.phase == "armed" && staged.request.version == version,
            "Confirmação de instalação inválida"
        );
        storage::atomic_json(&staged.dir.join("authorized.json"), &staged.request.nonce)?;
        write_receipt(
            &self.root,
            version,
            &self.installation.executable,
            "installing",
            "Instalação autorizada; aguardando fechamento do aplicativo",
        )?;
        state.snapshot.phase = "handoff".into();
        state.snapshot.revision += 1;
        Ok(())
    }
    async fn download(&self, package: &Package, path: &Path) -> Result<()> {
        let url = self.trust.check_url(&package.url)?;
        let response = self
            .download_response(client(&self.trust, 1800)?.get(url))
            .await?;
        ensure!(
            response.content_length().is_none_or(|n| n == package.size),
            "Tamanho anunciado não confere"
        );
        let file = OpenOptions::new().create_new(true).write(true).open(path)?;
        let mut file = tokio::fs::File::from_std(file);
        let mut stream = response.bytes_stream();
        let mut received = 0u64;
        let mut last_chunk = std::time::Instant::now();
        loop {
            ensure!(!self.cancel.load(Ordering::Relaxed), "Download cancelado");
            let next = tokio::select! {chunk=stream.next()=>chunk, _=tokio::time::sleep(Duration::from_millis(150))=>{ensure!(!self.cancel.load(Ordering::Relaxed),"Download cancelado");ensure!(last_chunk.elapsed()<Duration::from_secs(30),"Download sem progresso por 30 segundos. Tente novamente");continue}};
            let Some(chunk) = next else { break };
            let chunk = chunk?;
            last_chunk = std::time::Instant::now();
            received += chunk.len() as u64;
            ensure!(
                received <= package.size,
                "Pacote excede o tamanho declarado"
            );
            file.write_all(&chunk).await?;
            self.change(|s| s.received = received);
        }
        file.sync_all().await?;
        ensure!(received == package.size, "Download incompleto");
        Ok(())
    }
    async fn download_response(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response> {
        let pending = request.send();
        tokio::pin!(pending);
        let started = std::time::Instant::now();
        loop {
            ensure!(!self.cancel.load(Ordering::Relaxed), "Download cancelado");
            tokio::select! {
                response = &mut pending => return Ok(response?.error_for_status()?),
                _ = tokio::time::sleep(Duration::from_millis(150)) => {
                    ensure!(started.elapsed() < Duration::from_secs(30), "O servidor não iniciou o download em 30 segundos. Tente novamente");
                }
            }
        }
    }
}
fn package_name() -> &'static str {
    if cfg!(windows) {
        "package.exe"
    } else {
        "package.bin"
    }
}
fn helper_name() -> &'static str {
    if cfg!(windows) {
        "helper.exe"
    } else {
        "helper"
    }
}
pub fn verify_package(trust: &Trust, package: &Package, version: &str, path: &Path) -> Result<()> {
    ensure!(
        package.key_id != "catalog-v1",
        "Chave de catálogo não pode assinar pacotes"
    );
    storage::reject_symlink(path)?;
    ensure!(
        fs::metadata(path)?.len() == package.size,
        "Tamanho do pacote não confere"
    );
    ensure!(
        storage::digest(path)? == package.sha256,
        "SHA-256 do pacote não confere"
    );
    package.verify_signature(trust, PRODUCT, version)?;
    Ok(())
}
fn validate_destination(i: &Installation) -> Result<()> {
    ensure!(
        i.installable() && i.executable.is_absolute(),
        "Método de instalação não suportado"
    );
    storage::reject_symlink(&i.executable)?;
    ensure!(i.executable.is_file(), "Executável atual não encontrado");
    ensure!(
        dunce::canonicalize(&i.executable)? == i.executable,
        "Caminho de instalação mudou"
    );
    if i.mode == "appimage" {
        ensure!(!system_path(&i.executable), "Use o gerenciador do sistema");
        verify_appimage(&i.executable)?;
    }
    #[cfg(target_os = "windows")]
    if i.mode == "nsis" {
        ensure!(
            registered_nsis(&i.executable)?,
            "Registro da instalação por usuário não confere"
        );
    }
    if i.mode != "managed" {
        let parent = i.executable.parent().context("Pasta inválida")?;
        let probe = tempfile::NamedTempFile::new_in(parent)
            .context("Sem permissão de escrita na instalação")?;
        drop(probe);
    }
    Ok(())
}
fn managed_item(disk: &DiskState, i: &Installation, running: &str) -> Result<Installed> {
    ensure!(disk.schema_version == 1, "Inventário incompatível");
    let item = disk
        .inventory
        .get(PRODUCT)
        .context("Instalação ausente do inventário do Launcher")?;
    ensure!(
        item.app_id == PRODUCT
            && item.version == running
            && Some(PathBuf::from(&item.root)) == i.managed_root
            && dunce::canonicalize(&item.executable)? == i.executable,
        "Inventário não corresponde à instalação em execução"
    );
    platform::checked_executable(item)?;
    Ok(item.clone())
}
fn install_managed(
    data: &Path,
    source: &Path,
    request: &Request,
    selection: &Selection,
    catalog: &Catalog,
) -> Result<(PathBuf, Option<String>)> {
    let _guard = storage::acquire_lock(data)?;
    let state_path = data.join("state.json");
    let mut raw: serde_json::Value = limited_json(&state_path, 5_000_000)?;
    let disk: DiskState = serde_json::from_value(raw.clone())?;
    let old = managed_item(&disk, &request.installation, &request.previous_version)?;
    ensure!(
        !disk.jobs.iter().any(|j| crate::model::is_active(&j.phase)),
        "O Launcher tem operações pendentes"
    );
    let exe = platform::install_update(
        source,
        Path::new(&old.root),
        catalog.product(PRODUCT)?,
        &request.version,
        &selection.package,
    )?;
    confirm_product(&exe, &request.version)?;
    let item = Installed {
        app_id: PRODUCT.into(),
        name: old.name.clone(),
        version: request.version.clone(),
        kind: selection.package.kind.clone(),
        root: old.root.clone(),
        executable: exe.to_string_lossy().into(),
        executable_sha256: storage::digest(&exe)?,
        installed_at: Utc::now().to_rfc3339(),
        present: true,
        modified: false,
        previous_version: Some(old.version),
    };
    raw["inventory"][PRODUCT] = serde_json::to_value(&item)?;
    storage::atomic_json(&state_path, &raw)?;
    let warning = platform::write_shortcut(&item).err().map(|error| {
        format!("Atalho não atualizado: {error}. Abra o Launcher para reparar a integração.")
    });
    Ok((exe, warning))
}
fn cleanup(dir: &Path) {
    // Only exact names created by this operation, never recursive deletion.
    for name in [
        package_name(),
        "request.json",
        "authorized.json",
        "ready",
        helper_name(),
    ] {
        let p = dir.join(name);
        if fs::symlink_metadata(&p).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink()) {
            let _ = fs::remove_file(p);
        }
    }
    // Windows cannot unlink the running helper. Keep its ownership marker so
    // a later explicit attempt can remove that exact file after the helper exits.
    if fs::read_dir(dir).is_ok_and(|mut entries| {
        entries.all(|entry| entry.is_ok_and(|e| e.file_name() == "stage-owner.json"))
    }) {
        let marker = dir.join("stage-owner.json");
        if fs::symlink_metadata(&marker).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink()) {
            let _ = fs::remove_file(marker);
        }
    }
    let _ = fs::remove_dir(dir);
}
fn write_receipt(
    root: &Path,
    version: &str,
    executable: &Path,
    phase: &str,
    message: &str,
) -> Result<()> {
    storage::atomic_json(
        &root.join("receipt.json"),
        &serde_json::json!({"schemaVersion":1,"version":version,"executable":executable,"phase":phase,"message":message,"at":Utc::now().to_rfc3339()}),
    )
}
fn read_receipt(root: &Path, running: &str, executable: &Path) -> Option<String> {
    let r = limited_json::<serde_json::Value>(&root.join("receipt.json"), 16384).ok()?;
    let version = r["version"].as_str()?;
    if version == running
        && r["executable"].as_str() == executable.to_str()
        && r["phase"] == "installed"
    {
        let warning = r["message"]
            .as_str()
            .filter(|s| s.starts_with("Atalho"))
            .unwrap_or("");
        Some(format!(
            "Atualização confirmada: versão {running} em execução. {warning}"
        ))
    } else {
        Some(format!(
            "Última atualização para {version}: {}. Versão em execução: {running}.",
            r["message"].as_str().unwrap_or("Resultado não confirmado")
        ))
    }
}
/// Runs before Tauri startup. The only accepted request lives in this product's private staging directory.
pub fn run_helper(request_path: &Path) -> Result<()> {
    let root = data_root()?;
    let root = dunce::canonicalize(root)?;
    let path = dunce::canonicalize(request_path)?;
    let dir = path.parent().context("Pedido inválido")?;
    ensure!(
        dir.parent() == Some(root.as_path())
            && dir
                .file_name()
                .is_some_and(|s| s.to_string_lossy().starts_with("stage-"))
            && path.file_name().is_some_and(|n| n == "request.json"),
        "Pedido fora da pasta privada de atualização"
    );
    let request: Request = limited_json(&path, MAX_CATALOG as u64 + 65536)?;
    ensure!(
        request.schema_version == 1 && request.product == PRODUCT,
        "Pedido de outro produto/contrato"
    );
    let t = trust()?;
    let catalog = accept_catalog(&t, &request.envelope, &bundled()?)?;
    let selection = select(
        &catalog,
        &request.previous_version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        "stable",
    )?
    .context("Pacote incompatível")?;
    ensure!(
        selection.version == request.version,
        "Versão do pedido não confere"
    );
    fs::write(dir.join("ready"), request.nonce.as_bytes())?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .open(root.join("updater.lock"))?;
    // The original process holds this lock until it exits. No installer can run earlier.
    let mut acquired = false;
    for _ in 0..1200 {
        if fs2::FileExt::try_lock_exclusive(&lock).is_ok() {
            acquired = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    ensure!(
        acquired,
        "O aplicativo não encerrou; instalação não iniciada"
    );
    let authorization: Result<String> = limited_json(&dir.join("authorized.json"), 4096);
    ensure!(
        authorization.is_ok_and(|s| s == request.nonce),
        "Instalação não autorizada"
    );
    let result = (|| {
        validate_destination(&request.installation)?;
        ensure!(
            storage::digest(&request.installation.executable)? == request.previous_digest,
            "Executável foi alterado antes da instalação"
        );
        verify_package(
            &t,
            &selection.package,
            &request.version,
            &dir.join(package_name()),
        )?;
        for _ in 0..50 {
            if !other_instance(&request.installation) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        ensure!(
            !other_instance(&request.installation),
            "Outra instância do ArmaduraStruct está aberta; feche-a antes de instalar"
        );
        let mut shortcut_warning = None;
        let executable = if request.installation.mode == "managed" {
            let (exe, warning) = install_managed(
                &launcher_data()?,
                &dir.join(package_name()),
                &request,
                &selection,
                &catalog,
            )?;
            shortcut_warning = warning;
            exe
        } else {
            install_independent(
                &dir.join(package_name()),
                &request.installation,
                &selection.package,
            )?;
            if let Err(error) = confirm_product(&request.installation.executable, &request.version)
            {
                #[cfg(target_os = "linux")]
                restore_previous(&request.installation.executable, &request.previous_digest)?;
                return Err(error);
            }
            request.installation.executable.clone()
        };
        write_receipt(
            &root,
            &request.version,
            &executable,
            "installed",
            shortcut_warning
                .as_deref()
                .unwrap_or("Instalador concluído; aguardando confirmação da versão após reiniciar"),
        )?;
        Ok::<_, anyhow::Error>(executable)
    })();
    let executable = match result {
        Ok(p) => p,
        Err(e) => {
            write_receipt(
                &root,
                &request.version,
                &request.installation.executable,
                "failed",
                &format!("{e:#}"),
            )?;
            request.installation.executable.clone()
        }
    };
    // Restart was explicitly authorized together with installation.
    let _ = Command::new(&executable)
        .env_remove("LD_LIBRARY_PATH")
        .current_dir(executable.parent().context("Pasta inválida")?)
        .spawn();
    cleanup(dir);
    Ok(())
}
fn other_instance(i: &Installation) -> bool {
    let probe = Installed {
        app_id: PRODUCT.into(),
        name: String::new(),
        version: String::new(),
        kind: String::new(),
        root: String::new(),
        executable: i.executable.to_string_lossy().into(),
        executable_sha256: String::new(),
        installed_at: String::new(),
        present: true,
        modified: false,
        previous_version: None,
    };
    platform::is_running(&probe)
}
fn install_independent(source: &Path, i: &Installation, package: &Package) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        ensure!(
            i.mode == "appimage" && package.kind == "appimage",
            "Método de instalação incompatível"
        );
        verify_appimage(source)?;
        use std::os::unix::fs::PermissionsExt;
        let target = &i.executable;
        let parent = target.parent().context("Pasta inválida")?;
        let previous_digest = storage::digest(target)?;
        let backup = backup_path(target, &previous_digest);
        storage::reject_symlink(&backup)?;
        if backup.exists() {
            ensure!(
                storage::digest(&backup)? == previous_digest,
                "Já existe outro arquivo no destino da cópia anterior"
            );
        } else {
            let mut saved = tempfile::NamedTempFile::new_in(parent)?;
            std::io::copy(&mut File::open(target)?, &mut saved)?;
            saved.as_file().sync_all()?;
            fs::set_permissions(saved.path(), fs::metadata(target)?.permissions())?;
            saved.persist_noclobber(&backup).map_err(|e| e.error)?;
        }
        let mut staged = tempfile::NamedTempFile::new_in(parent)?;
        std::io::copy(&mut File::open(source)?, &mut staged)?;
        staged.as_file().sync_all()?;
        ensure!(
            storage::digest(staged.path())? == package.sha256,
            "Cópia de instalação não confere"
        );
        fs::set_permissions(staged.path(), fs::Permissions::from_mode(0o755))?;
        staged.persist(target).map_err(|e| e.error)?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        ensure!(
            i.mode == "nsis" && package.kind == "nsis" && registered_nsis(&i.executable)?,
            "Método de instalação incompatível"
        );
        use std::os::windows::process::CommandExt;
        // Fixed per-user arguments; no elevation, command shell or frontend path.
        let installer = source.to_path_buf();
        ensure!(
            storage::digest(&installer)? == package.sha256,
            "Cópia do instalador não confere"
        );
        let status = Command::new(&installer)
            .arg("/S")
            .arg("/CURRENTUSER")
            .arg("/NORESTART")
            .arg("/UPDATE")
            .raw_arg(format!("/D={}", i.executable.parent().unwrap().display()))
            .status()?;
        ensure!(
            status.success(),
            "Instalador retornou erro: {:?}",
            status.code()
        );
        ensure!(
            i.executable.is_file(),
            "Instalador não produziu o executável esperado"
        );
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        bail!("Sistema não suportado")
    }
}

#[cfg(test)]
mod tests;

fn confirm_product(executable: &Path, expected: &str) -> Result<()> {
    use std::process::Stdio;
    let mut child = Command::new(executable)
        .arg("--openstruct-product-info")
        .env_remove("LD_LIBRARY_PATH")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    for _ in 0..200 {
        if let Some(status) = child.try_wait()? {
            ensure!(
                status.success(),
                "A versão instalada não pôde ser confirmada"
            );
            use std::io::Read;
            let mut output = Vec::new();
            child
                .stdout
                .take()
                .context("Resultado de versão ausente")?
                .take(4096)
                .read_to_end(&mut output)?;
            let info: serde_json::Value = serde_json::from_slice(&output)?;
            ensure!(
                info["product"] == PRODUCT && info["version"] == expected,
                "O instalador não produziu a versão escolhida"
            );
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    bail!("Tempo de confirmação da versão excedido")
}

#[cfg(target_os = "linux")]
fn backup_path(target: &Path, digest: &str) -> PathBuf {
    target.parent().unwrap().join(format!(
        "{}.openstruct-previous-{}",
        target.file_name().unwrap().to_string_lossy(),
        &digest[..12]
    ))
}
#[cfg(target_os = "linux")]
fn restore_previous(target: &Path, expected: &str) -> Result<()> {
    let previous = backup_path(target, expected);
    storage::reject_symlink(&previous)?;
    ensure!(
        storage::digest(&previous)? == expected,
        "A cópia anterior não confere; restauração automática recusada"
    );
    let mut restored = tempfile::NamedTempFile::new_in(target.parent().unwrap())?;
    std::io::copy(&mut File::open(&previous)?, &mut restored)?;
    restored.as_file().sync_all()?;
    fs::set_permissions(restored.path(), fs::metadata(previous)?.permissions())?;
    restored.persist(target).map_err(|e| e.error)?;
    Ok(())
}
