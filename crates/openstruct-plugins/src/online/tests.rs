use super::*;
use crate::contract::Host;
use serde_json::json;
use std::{
    io::{Cursor, Write},
    sync::mpsc,
};
use tiny_http::{Response, Server};
use zip::{write::SimpleFileOptions, ZipWriter};
fn fixture() -> (Value, Vec<u8>) {
    let m: Value = serde_json::from_str(include_str!(
        "../../../../examples/plugins/straight-bar/manifest.json"
    ))
    .unwrap();
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    let opt = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    w.start_file("manifest.json", opt).unwrap();
    w.write_all(&serde_json::to_vec(&m).unwrap()).unwrap();
    w.start_file("README.txt", opt).unwrap();
    w.write_all(include_bytes!(
        "../../../../examples/plugins/straight-bar/README.txt"
    ))
    .unwrap();
    (m, w.finish().unwrap().into_inner())
}
fn service(tmp: &tempfile::TempDir) -> Service {
    Service::new(
        tmp.path().join("plugins"),
        Host {
            app_version: "0.6.0".into(),
            platform: "linux".into(),
            architecture: "x86_64".into(),
        },
    )
    .unwrap()
}
#[tokio::test]
async fn real_loopback_catalog_download_inspect_explicit_install_and_integrity_error() {
    let (m, bytes) = fixture();
    let server = Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr());
    let catalog = json!({"schema":"openstruct.plugin-catalog/1","name":"Fixture (não oficial)","publisher":{"id":"org.example","name":"Test"},"plugins":[{"manifest":m,"artifacts":[{"url":format!("{base}/plugin.osplugin"),"size":bytes.len(),"sha256":package::sha256(&bytes),"platform":"any","architecture":"any","runtime":"declarative"}]}]});
    let (tx, rx) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        for request in server.incoming_requests().take(3) {
            if request.url() == "/catalog.json" {
                request
                    .respond(Response::from_string(catalog.to_string()))
                    .unwrap();
            } else {
                let corrupt = rx.try_recv().is_ok();
                let mut b = bytes.clone();
                if corrupt {
                    b[0] ^= 1;
                }
                request.respond(Response::from_data(b)).unwrap();
            }
        }
    });
    let tmp = tempfile::tempdir().unwrap();
    let s = service(&tmp);
    let catalog = s
        .catalog_with_policy(
            &format!("{base}/catalog.json"),
            &Uuid::new_v4().to_string(),
            Policy::Loopback,
        )
        .await
        .unwrap();
    assert!(s.list().unwrap().is_empty());
    let offer = catalog.entries[0].artifacts[0].offer_id.as_ref().unwrap();
    let i = s
        .prepare_with_policy(offer, &Uuid::new_v4().to_string(), Policy::Loopback)
        .await
        .unwrap();
    assert!(s.list().unwrap().is_empty());
    s.install(&i.token).unwrap();
    assert_eq!(s.list().unwrap().len(), 1);
    tx.send(()).unwrap();
    let err = s
        .prepare_with_policy(offer, &Uuid::new_v4().to_string(), Policy::Loopback)
        .await
        .err()
        .unwrap();
    assert!(err.to_string().contains("integridade"));
    assert_eq!(s.list().unwrap().len(), 1);
    thread.join().unwrap();
}
#[tokio::test]
async fn cancellation_and_redirect_do_not_register_anything() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr());
    let (started, received) = mpsc::channel();
    let (release, hold) = mpsc::channel();
    let t = std::thread::spawn(move || {
        let request = server.recv().unwrap();
        started.send(()).unwrap();
        hold.recv().unwrap();
        let _ = request.respond(Response::from_string("{}"));
        let request = server.recv().unwrap();
        request
            .respond(Response::empty(302).with_header(
                tiny_http::Header::from_bytes("Location", "http://127.0.0.1/private").unwrap(),
            ))
            .unwrap();
    });
    let tmp = tempfile::tempdir().unwrap();
    let s = Arc::new(service(&tmp));
    let id = Uuid::new_v4().to_string();
    let op_id = id.clone();
    let svc = s.clone();
    let u = format!("{base}/catalog.json");
    let task =
        tokio::spawn(async move { svc.catalog_with_policy(&u, &op_id, Policy::Loopback).await });
    tokio::task::spawn_blocking(move || received.recv().unwrap())
        .await
        .unwrap();
    s.cancel(&id).unwrap();
    let err = tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .err()
        .unwrap();
    assert!(err.to_string().contains("cancelada"));
    assert!(s.list().unwrap().is_empty());
    release.send(()).unwrap();
    let err = s
        .catalog_with_policy(
            &format!("{base}/redirect"),
            &Uuid::new_v4().to_string(),
            Policy::Loopback,
        )
        .await
        .err()
        .unwrap();
    assert!(err.to_string().contains("302"));
    assert!(s.list().unwrap().is_empty());
    t.join().unwrap();
}
#[test]
fn production_source_policy_blocks_local_credentials_redirect_origins() {
    for url in [
        "http://example.com/catalog.json",
        "https://127.0.0.1/a",
        "https://localhost/a",
        "https://user:pass@example.com/a",
        "https://example.com:444/a",
        "https://example.com/a?token=x",
        "https://example.local/a",
    ] {
        assert!(source_url(url, Policy::Public).is_err());
    }
    assert!(source_url("https://plugins.example.com/catalog.json", Policy::Public).is_ok());
    for ip in [
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "192.0.2.1",
        "::1",
        "::ffff:127.0.0.1",
        "2001:db8::1",
    ] {
        assert!(!public_ip(ip.parse().unwrap()));
    }
}
