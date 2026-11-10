use openstruct_plugins::{
    contract::{self, Host},
    package, Service,
};
use serde_json::{json, Value};
use std::{
    io::{Cursor, Write},
    sync::{Arc, Barrier},
};
use zip::{write::SimpleFileOptions, ZipWriter};
fn manifest() -> Value {
    serde_json::from_str(include_str!(
        "../../../examples/plugins/straight-bar/manifest.json"
    ))
    .unwrap()
}
fn host() -> Host {
    Host {
        app_version: "0.6.0".into(),
        platform: "linux".into(),
        architecture: "x86_64".into(),
    }
}
fn archive(m: Value) -> Vec<u8> {
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    let opt = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    w.start_file("manifest.json", opt).unwrap();
    w.write_all(&serde_json::to_vec(&m).unwrap()).unwrap();
    w.start_file("README.txt", opt).unwrap();
    w.write_all(include_bytes!(
        "../../../examples/plugins/straight-bar/README.txt"
    ))
    .unwrap();
    w.finish().unwrap().into_inner()
}
fn service(tmp: &tempfile::TempDir) -> Service {
    Service::new(tmp.path().join("plugins"), host()).unwrap()
}
#[test]
fn install_reopen_remove_offline_and_identity_conflicts() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("user-project.json");
    std::fs::write(&project, b"preserve-project").unwrap();
    let s = service(&tmp);
    let bytes = archive(manifest());
    let selected = tmp.path().join("selected.osplugin");
    std::fs::write(&selected, &bytes).unwrap();
    let i = s
        .inspect_file(
            &mut std::fs::File::open(selected).unwrap(),
            "selected.osplugin",
        )
        .unwrap();
    assert!(s.list().unwrap().is_empty());
    assert_eq!(s.install(&i.token).unwrap().outcome, "installed");
    assert!(s.install(&i.token).is_err());
    let i = s.inspect_bytes(&bytes, "offline duplicate".into()).unwrap();
    assert_eq!(s.install(&i.token).unwrap().outcome, "already-installed");
    let mut changed = manifest();
    changed["description"] = json!("outro conteúdo");
    let i = s
        .inspect_bytes(&archive(changed), "conflict".into())
        .unwrap();
    assert!(s
        .install(&i.token)
        .err()
        .unwrap()
        .to_string()
        .contains("conteúdo diferente"));
    drop(s);
    let reopened = service(&tmp);
    let items = reopened.list().unwrap();
    assert_eq!(items.len(), 1);
    assert!(!items[0].record.enabled);
    assert_eq!(items[0].status, "runtime-unsupported");
    reopened
        .remove("org.example.straight-bar", "1.0.0")
        .unwrap();
    assert!(reopened.list().unwrap().is_empty());
    assert_eq!(std::fs::read(project).unwrap(), b"preserve-project");
    assert!(reopened.remove("../../projects", "1.0.0").is_err());
}
#[test]
fn incompatible_required_runtime_and_atomic_failure() {
    let tmp = tempfile::tempdir().unwrap();
    let s = service(&tmp);
    for (key, value) in [
        ("pluginApi", json!({"min":"2.0.0","maxExclusive":"3.0.0"})),
        ("app", json!({"min":"9.0.0","maxExclusive":"10.0.0"})),
    ] {
        let mut m = manifest();
        m["compatibility"][key] = value;
        let i = s.inspect_bytes(&archive(m), "incompatible".into()).unwrap();
        assert!(!i.compatibility.compatible);
        assert!(s.install(&i.token).is_err());
    }
    let mut m = manifest();
    m["capabilities"]["required"] = json!(["unknown.required"]);
    let i = s.inspect_bytes(&archive(m), "capability".into()).unwrap();
    assert!(s.install(&i.token).is_err());
    let mut m = manifest();
    m["runtime"]["kind"] = json!("python-future");
    m["description"] = json!("<img src=x onerror=alert(1)>");
    let i = s
        .inspect_bytes(&archive(m), "future-runtime".into())
        .unwrap();
    assert!(i.compatibility.compatible);
    assert_eq!(i.compatibility.execution, "unsupported");
    s.install(&i.token).unwrap();
    // Interrupted staging is invisible, and a storage failure preserves existing installation.
    std::fs::create_dir(tmp.path().join("plugins/.staging/interrupted")).unwrap();
    let mut m = manifest();
    m["version"] = json!("1.1.0");
    let i = s.inspect_bytes(&archive(m), "new".into()).unwrap();
    // A file occupying the destination is a portable storage fault. Renaming
    // .staging while NamedTempFile is open is Unix-specific and not part of
    // the installer: Windows correctly denies that unrelated directory move.
    let obstruction = tmp
        .path()
        .join("plugins/installed/org.example.straight-bar/1.1.0");
    std::fs::write(&obstruction, b"not-a-directory").unwrap();
    assert!(s.install(&i.token).is_err());
    std::fs::remove_file(obstruction).unwrap();
    assert_eq!(s.list().unwrap().len(), 1);
}
#[test]
fn concurrent_services_never_overwrite_or_duplicate() {
    let tmp = tempfile::tempdir().unwrap();
    let a = Arc::new(service(&tmp));
    let b = Arc::new(service(&tmp));
    let bytes = archive(manifest());
    let x = a.inspect_bytes(&bytes, "a".into()).unwrap();
    let y = b.inspect_bytes(&bytes, "b".into()).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let c = barrier.clone();
    let t = std::thread::spawn(move || {
        c.wait();
        a.install(&x.token).map(|r| r.outcome)
    });
    barrier.wait();
    let other = b.install(&y.token);
    let first = t.join().unwrap();
    assert!(other.is_ok() || first.is_ok());
    assert_eq!(b.list().unwrap().len(), 1);
}
#[test]
fn zip_schema_hash_resource_and_duplicate_keys_are_rejected() {
    let valid = archive(manifest());
    assert!(package::inspect(&valid).is_ok());
    for bad in [
        b"not a zip".to_vec(),
        valid[..valid.len() - 8].to_vec(),
        vec![0; package::MAX_PACKAGE + 1],
    ] {
        assert!(package::inspect(&bad).is_err());
    }
    let mut m = manifest();
    m["schema"] = json!("openstruct.plugin/99");
    assert!(package::inspect(&archive(m)).is_err());
    let mut m = manifest();
    m["files"]["README.txt"]["sha256"] = json!("0".repeat(64));
    assert!(package::inspect(&archive(m)).is_err());
    let mut m = manifest();
    m["runtime"]["entry"] = json!("../outside");
    assert!(package::inspect(&archive(m)).is_err());
    let mut m = manifest();
    m["contributions"][0]["inputSchema"] =
        json!({"type":"object","$ref":"https://unsafe.invalid/schema"});
    assert!(contract::validate_manifest(&m).is_err());
    assert!(contract::parse_json(br#"{"schema":1,"schema":2}"#).is_err());
    let raw_zip = |names: Vec<&str>| {
        let mut w = ZipWriter::new(Cursor::new(Vec::new()));
        for name in names {
            w.start_file(
                name,
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            w.write_all(b"x").unwrap();
        }
        w.finish().unwrap().into_inner()
    };
    for name in [
        "../outside",
        "/absolute",
        "C:/drive",
        "a\\b",
        "CON.txt",
        "a/../b",
    ] {
        assert!(package::inspect(&raw_zip(vec![name])).is_err());
    }
    assert!(package::inspect(&raw_zip(vec!["a.txt", "A.txt"])).is_err());
    let mut duplicate = raw_zip(vec!["one.txt", "two.txt"]);
    for i in 0..duplicate.len() - 7 {
        if &duplicate[i..i + 7] == b"two.txt" {
            duplicate[i..i + 7].copy_from_slice(b"one.txt");
        }
    }
    assert!(package::inspect(&duplicate).is_err());
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    w.add_symlink("link", "/etc/passwd", SimpleFileOptions::default())
        .unwrap();
    assert!(package::inspect(&w.finish().unwrap().into_inner()).is_err());
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    w.start_file(
        "bomb",
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
    )
    .unwrap();
    w.write_all(&vec![0; 1024 * 1024]).unwrap();
    assert!(package::inspect(&w.finish().unwrap().into_inner()).is_err());
    assert!(
        contract::parse_json(format!("{}0{}", "[".repeat(30), "]".repeat(30)).as_bytes()).is_err()
    );
}
#[test]
fn platform_change_is_explicit_after_reopen() {
    let tmp = tempfile::tempdir().unwrap();
    let s = service(&tmp);
    let mut m = manifest();
    m["platforms"] = json!(["linux"]);
    let i = s.inspect_bytes(&archive(m), "offline".into()).unwrap();
    s.install(&i.token).unwrap();
    drop(s);
    let mut other = host();
    other.platform = "windows".into();
    let s = Service::new(tmp.path().join("plugins"), other).unwrap();
    assert_eq!(s.list().unwrap()[0].status, "platform-unavailable");
}

#[test]
fn inventory_manifest_tampering_and_false_expanded_size_are_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let s = service(&tmp);
    let bytes = archive(manifest());
    let i = s.inspect_bytes(&bytes, "fixture".into()).unwrap();
    s.install(&i.token).unwrap();
    let path = tmp
        .path()
        .join("plugins/installed/org.example.straight-bar/1.0.0/record.json");
    let mut record: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    record["manifest"]["description"] = json!("tampered");
    std::fs::write(path, serde_json::to_vec(&record).unwrap()).unwrap();
    assert!(s.list().is_err());
    let mut false_size = bytes;
    let central = false_size
        .windows(4)
        .position(|b| b == b"PK\x01\x02")
        .unwrap();
    let size = u32::from_le_bytes(false_size[22..26].try_into().unwrap()) - 1;
    false_size[22..26].copy_from_slice(&size.to_le_bytes());
    false_size[central + 24..central + 28].copy_from_slice(&size.to_le_bytes());
    assert!(package::inspect(&false_size).is_err());
}
