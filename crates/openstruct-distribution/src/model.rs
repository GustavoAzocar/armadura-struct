use anyhow::{bail, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::{Component, Path};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const MAX_PACKAGE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trust {
    pub catalog_url: Option<String>,
    pub keys: BTreeMap<String, String>,
    pub allowed_hosts: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u32,
    pub published_at: String,
    pub apps: Vec<Product>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Product {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub summary: String,
    pub description: String,
    pub category: String,
    pub icon: String,
    pub color: String,
    pub website: String,
    pub repository: String,
    pub documentation: String,
    pub features: Vec<String>,
    pub requirements: String,
    pub notice: String,
    pub releases: Vec<Release>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Release {
    pub version: String,
    pub channel: String,
    pub published_at: String,
    pub notes: String,
    pub assets: Vec<Package>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Package {
    pub platform: String,
    pub arch: String,
    pub kind: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub signature: String,
    pub key_id: String,
    pub min_launcher_version: String,
    pub executable: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
    pub key_id: String,
}

pub fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

pub fn valid_version(value: &str) -> bool {
    value.len() < 80 && !value.contains(['/', '\\', ':']) && Version::parse(value).is_ok()
}

pub fn valid_relative_exe(value: &str) -> bool {
    !value.contains(['\\', ':', '\0'])
        && value.ends_with(".exe")
        && Path::new(value)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
        && !value.is_empty()
}

pub fn validate_https(value: &str) -> Result<url::Url> {
    let url = url::Url::parse(value).context("Endereço inválido")?;
    ensure!(
        url.scheme() == "https" && url.host_str().is_some(),
        "O endereço precisa usar HTTPS"
    );
    ensure!(
        url.username().is_empty() && url.password().is_none(),
        "Credenciais não são aceitas no endereço"
    );
    ensure!(
        url.port().is_none() || url.port() == Some(443),
        "Porta não permitida"
    );
    Ok(url)
}

impl Trust {
    pub fn check_url(&self, value: &str) -> Result<url::Url> {
        let url = validate_https(value)?;
        ensure!(
            self.allowed_hosts
                .iter()
                .any(|h| Some(h.as_str()) == url.host_str()),
            "Origem de download não autorizada"
        );
        Ok(url)
    }

    pub fn verify(&self, key_id: &str, message: &[u8], signature: &str) -> Result<()> {
        let encoded = self
            .keys
            .get(key_id)
            .context("A chave desta publicação ainda não é reconhecida por este launcher")?;
        let bytes = STANDARD.decode(encoded).context("Chave pública inválida")?;
        let key: [u8; 32] = bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("Chave pública deve ter 32 bytes"))?;
        let signature = STANDARD.decode(signature).context("Assinatura inválida")?;
        let signature = Signature::from_slice(&signature).context("Assinatura inválida")?;
        VerifyingKey::from_bytes(&key)?
            .verify_strict(message, &signature)
            .context("A assinatura desta publicação não confere")
    }

    pub fn open_envelope(&self, envelope: &Envelope) -> Result<Catalog> {
        ensure!(
            envelope.payload.len() <= 2_000_000,
            "Catálogo excede o tamanho permitido"
        );
        self.verify(
            &envelope.key_id,
            envelope.payload.as_bytes(),
            &envelope.signature,
        )?;
        let catalog: Catalog =
            serde_json::from_str(&envelope.payload).context("Conteúdo do catálogo inválido")?;
        catalog.validate(self)?;
        Ok(catalog)
    }
}

impl Catalog {
    pub fn validate(&self, trust: &Trust) -> Result<()> {
        ensure!(
            self.schema_version == 1,
            "Este catálogo exige outra versão do launcher"
        );
        chrono::DateTime::parse_from_rfc3339(&self.published_at)
            .context("Data do catálogo inválida")?;
        ensure!(
            self.apps.len() <= 100,
            "Catálogo excede o número de aplicativos permitido"
        );
        let mut ids = HashSet::new();
        for app in &self.apps {
            ensure!(
                valid_id(&app.id) && ids.insert(&app.id),
                "Identificador de aplicativo inválido ou duplicado"
            );
            ensure!(
                !app.name.is_empty() && app.name.len() <= 100,
                "Nome de aplicativo inválido"
            );
            ensure!(
                app.summary.len() <= 1000 && app.description.len() <= 20000,
                "Descrição muito longa"
            );
            ensure!(
                app.features.len() <= 30 && app.features.iter().all(|s| s.len() < 2000),
                "Lista de recursos inválida"
            );
            ensure!(
                matches!(
                    app.icon.as_str(),
                    "consolostruct-atlas" | "molastruct-gaia" | "openstruct-mark"
                ),
                "Ícone não incluído no aplicativo"
            );
            ensure!(
                app.color.len() == 7
                    && app.color.starts_with('#')
                    && app.color[1..].bytes().all(|b| b.is_ascii_hexdigit()),
                "Cor inválida"
            );
            for link in [&app.website, &app.repository, &app.documentation] {
                validate_https(link)?;
            }
            ensure!(app.releases.len() <= 200, "Número excessivo de versões");
            let mut versions = HashSet::new();
            for release in &app.releases {
                ensure!(
                    valid_version(&release.version) && versions.insert(&release.version),
                    "Versão inválida ou duplicada"
                );
                ensure!(
                    matches!(release.channel.as_str(), "stable" | "beta"),
                    "Canal desconhecido"
                );
                ensure!(
                    release.channel != "stable" || Version::parse(&release.version)?.pre.is_empty(),
                    "Pré-lançamento não pode estar no canal estável"
                );
                chrono::DateTime::parse_from_rfc3339(&release.published_at)?;
                ensure!(
                    release.assets.len() <= 8 && !release.assets.is_empty(),
                    "Versão sem pacotes válidos"
                );
                let mut targets = HashSet::new();
                for asset in &release.assets {
                    ensure!(
                        targets.insert((&asset.platform, &asset.arch)),
                        "Plataforma duplicada na versão"
                    );
                    ensure!(
                        matches!(
                            (asset.platform.as_str(), asset.kind.as_str()),
                            ("linux", "appimage") | ("windows", "nsis")
                        ),
                        "Formato não suportado para a plataforma"
                    );
                    ensure!(
                        matches!(asset.arch.as_str(), "x86_64" | "aarch64"),
                        "Arquitetura desconhecida"
                    );
                    ensure!(
                        asset.size > 0 && asset.size <= MAX_PACKAGE_BYTES,
                        "Tamanho de pacote inválido"
                    );
                    ensure!(
                        asset.sha256.len() == 64
                            && asset
                                .sha256
                                .bytes()
                                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
                        "SHA-256 inválido"
                    );
                    ensure!(
                        valid_version(&asset.min_launcher_version),
                        "Versão mínima do launcher inválida"
                    );
                    ensure!(
                        valid_id(&asset.key_id) && trust.keys.contains_key(&asset.key_id),
                        "Chave de pacote não configurada"
                    );
                    ensure!(
                        STANDARD
                            .decode(&asset.signature)
                            .map(|v| v.len() == 64)
                            .unwrap_or(false),
                        "Assinatura de pacote inválida"
                    );
                    trust.check_url(&asset.url)?;
                    asset.verify_signature(trust, &app.id, &release.version)?;
                    if asset.kind == "nsis" {
                        ensure!(
                            asset
                                .executable
                                .as_deref()
                                .map(valid_relative_exe)
                                .unwrap_or(false),
                            "Executável Windows inválido"
                        );
                    } else {
                        ensure!(
                            asset.executable.is_none(),
                            "AppImage não aceita caminho de executável"
                        );
                    }
                }
            }
        }
        Ok(())
    }

    pub fn product(&self, id: &str) -> Result<&Product> {
        self.apps
            .iter()
            .find(|a| a.id == id)
            .context("Aplicativo não encontrado no catálogo")
    }
}

impl Package {
    pub fn signed_message(&self, id: &str, version: &str) -> String {
        format!(
            "OPENSTRUCT-PACKAGE-V1\n{id}\n{version}\n{}\n{}\n{}\n{}\n{}\n{}",
            self.platform,
            self.arch,
            self.kind,
            self.size,
            self.sha256,
            self.executable.as_deref().unwrap_or("")
        )
    }
    pub fn verify_signature(&self, trust: &Trust, id: &str, version: &str) -> Result<()> {
        trust.verify(
            &self.key_id,
            self.signed_message(id, version).as_bytes(),
            &self.signature,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub theme: String,
    pub language: String,
    pub channel: String,
    pub check_on_start: bool,
    pub install_root: String,
    pub catalog_url: Option<String>,
    pub hidden_apps: Vec<String>,
}

impl Settings {
    pub fn validate(&self, trust: &Trust) -> Result<()> {
        ensure!(
            matches!(self.theme.as_str(), "light" | "dark" | "system"),
            "Tema inválido"
        );
        ensure!(
            matches!(self.language.as_str(), "pt-BR" | "en"),
            "Idioma inválido"
        );
        ensure!(
            matches!(self.channel.as_str(), "stable" | "beta"),
            "Canal inválido"
        );
        ensure!(
            Path::new(&self.install_root).is_absolute(),
            "A pasta de instalação deve ser absoluta"
        );
        ensure!(
            self.hidden_apps.len() <= 100 && self.hidden_apps.iter().all(|id| valid_id(id)),
            "Aplicativos ocultos inválidos"
        );
        if let Some(url) = self.catalog_url.as_deref().filter(|u| !u.is_empty()) {
            trust.check_url(url)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub app_id: String,
    pub name: String,
    pub version: String,
    pub kind: String,
    pub root: String,
    pub executable: String,
    pub executable_sha256: String,
    pub installed_at: String,
    pub present: bool,
    pub modified: bool,
    pub previous_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub app_id: String,
    pub app_name: String,
    pub version: String,
    pub phase: String,
    pub received: u64,
    pub total: u64,
    pub created_at: String,
    pub error: Option<String>,
    pub allow_downgrade: bool,
}

pub fn is_active(phase: &str) -> bool {
    matches!(phase, "queued" | "downloading" | "verifying" | "installing")
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskState {
    pub schema_version: u32,
    pub settings: Settings,
    pub inventory: BTreeMap<String, Installed>,
    pub jobs: Vec<Job>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub catalog: Catalog,
    pub settings: Settings,
    pub inventory: BTreeMap<String, Installed>,
    pub jobs: Vec<Job>,
    pub platform: String,
    pub arch: String,
    pub native: bool,
    pub catalog_source: String,
    pub checked_at: Option<String>,
    pub warnings: Vec<String>,
    pub running_apps: Vec<String>,
    pub launcher_version: String,
}

pub fn newer(candidate: &str, installed: &str) -> Result<bool> {
    Ok(Version::parse(candidate)? > Version::parse(installed)?)
}

pub fn ensure_supported_host() -> Result<()> {
    if !matches!(std::env::consts::OS, "linux" | "windows") {
        bail!("Este sistema ainda não é suportado");
    }
    Ok(())
}
