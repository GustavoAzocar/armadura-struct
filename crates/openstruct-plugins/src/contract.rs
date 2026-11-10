use anyhow::{bail, ensure, Context, Result};
use semver::Version;
use serde::{
    de::{MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use serde_json::{Map, Value};
use std::{collections::HashSet, fmt, sync::OnceLock};

pub const PLUGIN_API: &str = "1.0.0";
pub const REBAR_API: &str = "1.0.0"; // The domain façade spells the same contract "1.0".
pub const CAPABILITIES: &[&str] = &["host.inspect", "rebar.batch.v1"];
pub const MANIFEST_SCHEMA: &str = include_str!("../../../public/plugins/v1/manifest.schema.json");
pub const CATALOG_SCHEMA: &str = include_str!("../../../public/plugins/v1/catalog.schema.json");

#[derive(Clone, Debug)]
pub struct Host {
    pub app_version: String,
    pub platform: String,
    pub architecture: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compatibility {
    pub compatible: bool,
    pub platform_available: bool,
    pub reasons: Vec<String>,
    pub ignored_optional: Vec<String>,
    pub execution: &'static str,
}

// JSON duplicate keys are ambiguous across implementations; reject, never last-wins.
struct Unique(Value);
impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Unique;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("JSON sem chaves duplicadas")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> std::result::Result<Unique, E> {
                serde_json::Number::from_f64(v)
                    .map(|n| Unique(Value::Number(n)))
                    .ok_or_else(|| E::custom("Número inválido"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_none<E: serde::de::Error>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut out = Vec::new();
                while let Some(Unique(v)) = a.next_element()? {
                    out.push(v);
                }
                Ok(Unique(Value::Array(out)))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut out = Map::new();
                while let Some((k, Unique(v))) = a.next_entry::<String, Unique>()? {
                    if out.insert(k.clone(), v).is_some() {
                        return Err(serde::de::Error::custom(format!(
                            "Chave JSON duplicada: {k}"
                        )));
                    }
                }
                Ok(Unique(Value::Object(out)))
            }
        }
        d.deserialize_any(V)
    }
}
pub fn parse_json(bytes: &[u8]) -> Result<Value> {
    let Unique(v) = serde_json::from_slice(bytes).context("JSON inválido")?;
    let mut nodes = 0;
    fn limits(v: &Value, depth: usize, nodes: &mut usize) -> Result<()> {
        *nodes += 1;
        ensure!(
            depth <= 24 && *nodes <= 100_000,
            "JSON excede limites de profundidade/complexidade"
        );
        match v {
            Value::Array(a) => {
                for v in a {
                    limits(v, depth + 1, nodes)?;
                }
            }
            Value::Object(o) => {
                for v in o.values() {
                    limits(v, depth + 1, nodes)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    limits(&v, 0, &mut nodes)?;
    Ok(v)
}
fn validator(
    schema: &'static str,
    cell: &'static OnceLock<jsonschema::Validator>,
) -> &'static jsonschema::Validator {
    cell.get_or_init(|| {
        jsonschema::validator_for(&serde_json::from_str::<Value>(schema).expect("schema JSON"))
            .expect("schema público válido")
    })
}
pub fn validate_manifest(v: &Value) -> Result<()> {
    static SCHEMA: OnceLock<jsonschema::Validator> = OnceLock::new();
    if let Err(e) = validator(MANIFEST_SCHEMA, &SCHEMA).validate(v) {
        bail!("Manifesto: {e}");
    }
    ensure!(
        serde_json::to_vec(v)?.len() <= 128 * 1024,
        "Manifesto maior que 128 KiB"
    );
    let id = v["id"].as_str().unwrap();
    ensure!(
        !["host.", "tauri.", "armadurastruct.", "openstruct.host."]
            .iter()
            .any(|p| id.starts_with(p)),
        "Namespace reservado"
    );
    Version::parse(v["version"].as_str().unwrap()).context("SemVer do plugin inválida")?;
    for range in v["compatibility"].as_object().unwrap().values() {
        let min = Version::parse(range["min"].as_str().unwrap())?;
        let max = Version::parse(range["maxExclusive"].as_str().unwrap())?;
        ensure!(
            min < max
                && min.pre.is_empty()
                && max.pre.is_empty()
                && min.build.is_empty()
                && max.build.is_empty(),
            "Intervalo SemVer inválido; use versões estáveis e min < maxExclusive"
        );
    }
    for key in ["platforms", "architectures"] {
        let a = v[key].as_array().unwrap();
        ensure!(
            !(a.len() > 1 && a.iter().any(|v| v == "any")),
            "any deve aparecer sozinho em {key}"
        );
    }
    let mut ids = HashSet::new();
    for g in v["contributions"].as_array().unwrap() {
        ensure!(
            ids.insert(g["id"].as_str().unwrap()),
            "Contribuição duplicada"
        );
        // The public parameter subset cannot contain references or executable patterns.
        jsonschema::validator_for(&g["inputSchema"]).context("Schema de parâmetros inválido")?;
    }
    for link in v["links"].as_object().unwrap().values() {
        let u = url::Url::parse(link.as_str().unwrap())?;
        ensure!(
            u.scheme() == "https"
                && u.username().is_empty()
                && u.password().is_none()
                && u.host_str().is_some(),
            "Link inválido"
        );
    }
    for name in v["files"].as_object().unwrap().keys() {
        safe_path(name)?;
        ensure!(
            name != "manifest.json",
            "Manifesto não pode conter hash de si mesmo"
        );
    }
    if let Some(entry) = v["runtime"]["entry"].as_str() {
        ensure!(
            v["files"].get(entry).is_some(),
            "Entrada do runtime ausente em files"
        );
    }
    Ok(())
}
pub fn validate_catalog(v: &Value) -> Result<()> {
    static SCHEMA: OnceLock<jsonschema::Validator> = OnceLock::new();
    if let Err(e) = validator(CATALOG_SCHEMA, &SCHEMA).validate(v) {
        bail!("Catálogo: {e}");
    }
    let mut ids = HashSet::new();
    for p in v["plugins"].as_array().unwrap() {
        validate_manifest(&p["manifest"])?;
        ensure!(
            ids.insert(format!(
                "{}@{}",
                p["manifest"]["id"], p["manifest"]["version"]
            )),
            "Plugin/versão duplicados no catálogo"
        );
        for a in p["artifacts"].as_array().unwrap() {
            let m = &p["manifest"];
            ensure!(
                a["runtime"] == m["runtime"]["kind"],
                "Runtime do artefato diverge do manifesto"
            );
            ensure!(
                m["platforms"].as_array().unwrap().contains(&a["platform"])
                    && m["architectures"]
                        .as_array()
                        .unwrap()
                        .contains(&a["architecture"]),
                "Plataforma do artefato diverge do manifesto"
            );
        }
    }
    Ok(())
}
pub fn safe_path(name: &str) -> Result<()> {
    ensure!(
        !name.is_empty() && name.len() <= 160,
        "Caminho de pacote inválido"
    );
    for part in name.split('/') {
        ensure!(
            !part.is_empty()
                && !part.starts_with('.')
                && !part.ends_with('.')
                && part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)),
            "Caminho de pacote inseguro: {name}"
        );
        let base = part.split('.').next().unwrap().to_ascii_uppercase();
        ensure!(
            ![
                "__PROTO__",
                "CON",
                "PRN",
                "AUX",
                "NUL",
                "COM1",
                "COM2",
                "COM3",
                "COM4",
                "COM5",
                "COM6",
                "COM7",
                "COM8",
                "COM9",
                "LPT1",
                "LPT2",
                "LPT3",
                "LPT4",
                "LPT5",
                "LPT6",
                "LPT7",
                "LPT8",
                "LPT9"
            ]
            .contains(&base.as_str()),
            "Nome reservado: {name}"
        );
    }
    Ok(())
}
pub fn compatibility(v: &Value, h: &Host) -> Compatibility {
    let mut reasons = Vec::new();
    for (key, current) in [
        ("pluginApi", PLUGIN_API),
        ("rebarApi", REBAR_API),
        ("app", h.app_version.as_str()),
    ] {
        if let Some(r) = v["compatibility"].get(key) {
            let actual = Version::parse(current).unwrap();
            let min = Version::parse(r["min"].as_str().unwrap()).unwrap();
            let max = Version::parse(r["maxExclusive"].as_str().unwrap()).unwrap();
            if actual < min || actual >= max || !actual.pre.is_empty() {
                reasons.push(format!("{key}: requer >= {min} e < {max}; atual {actual}"));
            }
        }
    }
    for c in v["capabilities"]["required"].as_array().unwrap() {
        if !CAPABILITIES.contains(&c.as_str().unwrap()) {
            reasons.push(format!(
                "Capacidade obrigatória sem suporte: {}",
                c.as_str().unwrap()
            ));
        }
    }
    let supports = |key: &str, current: &str| {
        v[key]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "any" || p == current)
    };
    let platform_available =
        supports("platforms", &h.platform) && supports("architectures", &h.architecture);
    if !platform_available {
        reasons.push("Indisponível nesta plataforma/arquitetura".into());
    }
    Compatibility {
        compatible: reasons.is_empty(),
        platform_available,
        reasons,
        ignored_optional: v["capabilities"]["optional"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|c| {
                (!CAPABILITIES.contains(&c.as_str().unwrap())).then(|| c.as_str().unwrap().into())
            })
            .collect(),
        execution: "unsupported",
    }
}
