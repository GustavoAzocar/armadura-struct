use crate::{
    contract, package,
    store::{lock, Inspection, Service},
};
use anyhow::{bail, ensure, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::Notify;
use url::Url;
use uuid::Uuid;

pub(crate) struct Offer {
    manifest: Value,
    artifact: Value,
    source: Url,
    created: Instant,
}
pub(crate) struct Cancellation {
    cancelled: AtomicBool,
    notify: Notify,
}
impl Cancellation {
    fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }
    fn check(&self) -> Result<()> {
        ensure!(!self.cancelled.load(Ordering::SeqCst), "Operação cancelada");
        Ok(())
    }
    async fn wait(&self) {
        if !self.cancelled.load(Ordering::SeqCst) {
            self.notify.notified().await;
        }
    }
}
struct Operation<'a> {
    service: &'a Service,
    id: String,
    cancel: Arc<Cancellation>,
}
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        if let Ok(mut ops) = self.service.operations.lock() {
            ops.remove(&self.id);
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogArtifact {
    pub artifact: Value,
    pub offer_id: Option<String>,
    pub reason: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub manifest: Value,
    pub compatibility: contract::Compatibility,
    pub artifacts: Vec<CatalogArtifact>,
}
#[derive(Serialize)]
pub struct CatalogView {
    pub name: String,
    pub publisher: Value,
    pub source: String,
    pub entries: Vec<CatalogEntry>,
}
#[derive(Clone, Copy)]
enum Policy {
    Public,
    #[cfg(test)]
    Loopback,
}
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => {
            let [x, y, z, _] = a.octets();
            !(a.is_private()
                || a.is_loopback()
                || a.is_link_local()
                || a.is_multicast()
                || a.is_unspecified()
                || x == 0
                || x >= 224
                || (x == 100 && (64..=127).contains(&y))
                || (x == 192 && y == 0 && [0, 2].contains(&z))
                || (x == 192 && y == 88 && z == 99)
                || (x == 198 && [18, 19].contains(&y))
                || (x == 198 && y == 51 && z == 100)
                || (x == 203 && y == 0 && z == 113))
        }
        IpAddr::V6(a) => {
            let s = a.segments();
            s[0] & 0xe000 == 0x2000 && !(s[0] == 0x2001 && (s[1] == 0xdb8 || s[1] < 0x0200))
        }
    }
}
fn source_url(raw: &str, policy: Policy) -> Result<Url> {
    ensure!(raw.len() <= 2000, "URL excede 2000 caracteres");
    let u = Url::parse(raw).context("URL de catálogo inválida")?;
    let production = matches!(policy, Policy::Public);
    ensure!(
        (u.scheme() == "https" && (u.port().is_none() || u.port() == Some(443)))
            || (!production && u.scheme() == "http"),
        "Use HTTPS na porta 443"
    );
    ensure!(
        u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
            && u.host_str().is_some(),
        "URL não pode conter credenciais, consulta ou fragmento"
    );
    if production {
        let host = u.host_str().unwrap();
        ensure!(
            host.contains('.')
                && !host.ends_with(".local")
                && host != "localhost"
                && host.parse::<IpAddr>().is_err(),
            "Fonte deve usar domínio público"
        );
    }
    Ok(u)
}
async fn download(
    url: &Url,
    source: &Url,
    max: usize,
    cancel: &Cancellation,
    policy: Policy,
) -> Result<Vec<u8>> {
    ensure!(
        url.origin() == source.origin(),
        "Pacote deve ter a mesma origem HTTPS do catálogo"
    );
    source_url(url.as_str(), policy)?;
    cancel.check()?;
    let host = url.host_str().context("Fonte sem domínio")?;
    let resolution = tokio::net::lookup_host((host, url.port_or_known_default().unwrap()));
    let addrs: Vec<SocketAddr> = tokio::select! {
        r = tokio::time::timeout(Duration::from_secs(10), resolution) => r??.collect(),
        _ = cancel.wait() => bail!("Operação cancelada"),
    };
    ensure!(!addrs.is_empty(), "Domínio sem endereço");
    for a in &addrs {
        match policy {
            Policy::Public => ensure!(
                public_ip(a.ip()),
                "Endereço de rede privada/reservada recusado"
            ),
            #[cfg(test)]
            Policy::Loopback => ensure!(a.ip().is_loopback(), "Fixture deve usar loopback"),
        }
    }
    // Pin the checked DNS answers; redirects are deliberately disabled.
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .resolve_to_addrs(host, &addrs)
        .build()?;
    let request = client.get(url.clone()).send();
    let response = tokio::select! { r = request => r.context("Não foi possível conectar à fonte")?, _ = cancel.wait() => bail!("Operação cancelada") };
    ensure!(
        response.status().is_success() && !response.status().is_redirection(),
        "Fonte respondeu HTTP {}; redirecionamentos são recusados",
        response.status()
    );
    ensure!(
        response.content_length().is_none_or(|n| n <= max as u64),
        "Download maior que o limite"
    );
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    loop {
        let chunk = tokio::select! { c = stream.next() => c, _ = cancel.wait() => bail!("Operação cancelada") };
        let Some(chunk) = chunk else { break };
        let chunk = chunk?;
        ensure!(
            bytes.len() + chunk.len() <= max,
            "Download maior que o limite"
        );
        bytes.extend_from_slice(&chunk);
    }
    cancel.check()?;
    Ok(bytes)
}
impl Service {
    fn operation(&self, id: &str) -> Result<Operation<'_>> {
        Uuid::parse_str(id).context("Identificador de operação inválido")?;
        let mut ops = lock(&self.operations)?;
        ensure!(
            ops.len() < 4 && !ops.contains_key(id),
            "Operação duplicada/limite de operações"
        );
        let cancel = Arc::new(Cancellation::new());
        ops.insert(id.into(), cancel.clone());
        Ok(Operation {
            service: self,
            id: id.into(),
            cancel,
        })
    }
    pub fn cancel(&self, id: &str) -> Result<()> {
        if let Some(c) = lock(&self.operations)?.get(id) {
            c.cancelled.store(true, Ordering::SeqCst);
            c.notify.notify_one();
        }
        Ok(())
    }
    pub async fn catalog(&self, raw: &str, operation_id: &str) -> Result<CatalogView> {
        self.catalog_with_policy(raw, operation_id, Policy::Public)
            .await
    }
    async fn catalog_with_policy(
        &self,
        raw: &str,
        operation_id: &str,
        policy: Policy,
    ) -> Result<CatalogView> {
        let op = self.operation(operation_id)?;
        let source = source_url(raw, policy)?;
        let bytes = download(&source, &source, 2 * 1024 * 1024, &op.cancel, policy).await?;
        let catalog = contract::parse_json(&bytes)?;
        contract::validate_catalog(&catalog)?;
        let mut offers = HashMap::new();
        let mut entries = Vec::new();
        for p in catalog["plugins"].as_array().unwrap() {
            let manifest = &p["manifest"];
            let compatibility = contract::compatibility(manifest, &self.host);
            let mut artifacts = Vec::new();
            for artifact in p["artifacts"].as_array().unwrap() {
                let eligible = (artifact["platform"] == "any"
                    || artifact["platform"] == self.host.platform)
                    && (artifact["architecture"] == "any"
                        || artifact["architecture"] == self.host.architecture);
                let url = source_url(artifact["url"].as_str().unwrap(), policy)?;
                ensure!(
                    url.origin() == source.origin(),
                    "Artefato fora da origem do catálogo"
                );
                let offer_id =
                    (compatibility.compatible && eligible).then(|| Uuid::new_v4().to_string());
                if let Some(id) = &offer_id {
                    offers.insert(
                        id.clone(),
                        Offer {
                            manifest: manifest.clone(),
                            artifact: artifact.clone(),
                            source: source.clone(),
                            created: Instant::now(),
                        },
                    );
                }
                artifacts.push(CatalogArtifact {
                    artifact: artifact.clone(),
                    reason: offer_id
                        .is_none()
                        .then(|| "Artefato incompatível com este host".into()),
                    offer_id,
                });
            }
            entries.push(CatalogEntry {
                manifest: manifest.clone(),
                compatibility,
                artifacts,
            });
        }
        op.cancel.check()?;
        *lock(&self.offers)? = offers;
        Ok(CatalogView {
            name: catalog["name"].as_str().unwrap().into(),
            publisher: catalog["publisher"].clone(),
            source: source.to_string(),
            entries,
        })
    }
    pub async fn prepare_online(&self, offer_id: &str, operation_id: &str) -> Result<Inspection> {
        self.prepare_with_policy(offer_id, operation_id, Policy::Public)
            .await
    }
    async fn prepare_with_policy(
        &self,
        offer_id: &str,
        operation_id: &str,
        policy: Policy,
    ) -> Result<Inspection> {
        let op = self.operation(operation_id)?;
        let (manifest, artifact, source) = {
            let offers = lock(&self.offers)?;
            let o = offers
                .get(offer_id)
                .context("Oferta expirada; consulte novamente o catálogo")?;
            ensure!(
                o.created.elapsed() < Duration::from_secs(600),
                "Oferta expirada"
            );
            (o.manifest.clone(), o.artifact.clone(), o.source.clone())
        };
        let url = source_url(artifact["url"].as_str().unwrap(), policy)?;
        let bytes = download(&url, &source, package::MAX_PACKAGE, &op.cancel, policy).await?;
        ensure!(
            bytes.len() as u64 == artifact["size"].as_u64().unwrap()
                && package::sha256(&bytes) == artifact["sha256"].as_str().unwrap(),
            "Tamanho/integridade do download divergente"
        );
        ensure!(
            package::inspect(&bytes)? == manifest,
            "Identidade/manifesto do pacote diverge do catálogo"
        );
        op.cancel.check()?;
        let view = self.inspect_bytes(&bytes, format!("Catálogo: {source}"))?;
        if let Err(e) = op.cancel.check() {
            self.discard(&view.token)?;
            return Err(e);
        }
        Ok(view)
    }
}

#[cfg(test)]
mod tests;
