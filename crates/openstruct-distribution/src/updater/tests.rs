use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};

fn fixture() -> (Trust, Catalog, SigningKey) {
    let mut t = trust().unwrap();
    let e = bundled().unwrap();
    let mut c = t.open_envelope(&e).unwrap();
    c.apps.retain(|a| a.id == PRODUCT);
    let key = SigningKey::from_bytes(&[42; 32]);
    t.keys.insert(
        "test-only".into(),
        STANDARD.encode(key.verifying_key().to_bytes()),
    );
    t.keys.insert(
        "catalog-v1".into(),
        STANDARD.encode(key.verifying_key().to_bytes()),
    );
    let a = &mut c.apps[0];
    a.releases.truncate(1);
    a.releases[0].version = "0.10.0".into();
    for p in &mut a.releases[0].assets {
        p.key_id = "test-only".into();
        p.signature = STANDARD.encode(
            key.sign(p.signed_message(PRODUCT, "0.10.0").as_bytes())
                .to_bytes(),
        );
    }
    (t, c, key)
}
fn envelope(c: &Catalog, key: &SigningKey) -> Envelope {
    let payload = serde_json::to_string(c).unwrap();
    let signature = STANDARD.encode(key.sign(payload.as_bytes()).to_bytes());
    Envelope {
        payload,
        signature,
        key_id: "catalog-v1".into(),
    }
}
#[cfg(unix)]
fn fake_appimage(path: &Path, extra: u8) {
    let mut b = vec![extra; 80];
    b[..4].copy_from_slice(b"\x7fELF");
    b[8..11].copy_from_slice(b"AI\x02");
    fs::write(path, b).unwrap();
}
#[test]
fn production_catalog_and_package_signatures_are_compatible_with_launcher() {
    let t = trust().unwrap();
    let c = t.open_envelope(&bundled().unwrap()).unwrap();
    for r in &c.product(PRODUCT).unwrap().releases {
        for p in &r.assets {
            p.verify_signature(&t, PRODUCT, &r.version).unwrap();
        }
    }
}
#[test]
fn semantic_versions_and_no_downgrade() {
    let (_, c, _) = fixture();
    assert_eq!(
        select(&c, "0.9.0", "linux", "x86_64", "stable")
            .unwrap()
            .unwrap()
            .version,
        "0.10.0"
    );
    assert!(select(&c, "0.10.0", "linux", "x86_64", "stable")
        .unwrap()
        .is_none());
    assert!(select(&c, "1.0.0", "linux", "x86_64", "stable")
        .unwrap()
        .is_none());
    assert!(select(&c, "unknown", "linux", "x86_64", "stable").is_err());
}
#[test]
fn build_metadata_does_not_make_a_version_newer() {
    let (_, mut c, _) = fixture();
    c.apps[0].releases[0].version = "0.10.0+rebuilt".into();
    for installed in ["0.10.0", "0.10.0+different-build"] {
        assert!(select(&c, installed, "linux", "x86_64", "stable")
            .unwrap()
            .is_none());
    }
}
#[test]
fn platform_architecture_and_channel_are_respected() {
    let (_, mut c, _) = fixture();
    assert!(select(&c, "0.9.0", "linux", "aarch64", "stable").is_err());
    assert!(select(&c, "0.9.0", "macos", "x86_64", "stable").is_err());
    c.apps[0].releases[0].channel = "beta".into();
    c.apps[0].releases[0].version = "0.11.0-beta.1".into();
    assert!(select(&c, "0.9.0", "linux", "x86_64", "stable")
        .unwrap()
        .is_none());
    assert!(select(&c, "0.9.0", "linux", "x86_64", "beta")
        .unwrap()
        .is_some());
}
#[test]
fn prerelease_is_not_an_eligible_stable_release() {
    let (_, mut c, _) = fixture();
    c.apps[0].releases[0].version = "0.11.0-rc.1".into();
    assert!(select(&c, "0.9.0", "linux", "x86_64", "stable")
        .unwrap()
        .is_none());
}
#[test]
fn minimum_launcher_is_not_compared_to_product_version() {
    let (_, mut c, _) = fixture();
    for p in &mut c.apps[0].releases[0].assets {
        p.min_launcher_version = "9.0.0".into();
    }
    assert!(select(&c, "0.9.0", "linux", "x86_64", "stable")
        .unwrap_err()
        .to_string()
        .contains("núcleo"));
}
#[test]
fn changed_version_or_package_requires_new_confirmation() {
    let (_, mut c, _) = fixture();
    let old = select(&c, "0.9.0", "linux", "x86_64", "stable")
        .unwrap()
        .unwrap();
    c.apps[0].releases[0].assets[1].size += 1;
    let next = select(&c, "0.9.0", "linux", "x86_64", "stable")
        .unwrap()
        .unwrap();
    assert!(same_selection(&old, &next).is_err());
}
#[test]
fn invalid_unknown_and_tampered_catalog_never_become_trusted() {
    let (t, c, key) = fixture();
    let e = envelope(&c, &key);
    t.open_envelope(&e).unwrap();
    let mut bad = e.clone();
    bad.payload.push(' ');
    assert!(t.open_envelope(&bad).is_err());
    bad = e.clone();
    bad.key_id = "remote-key".into();
    assert!(t.open_envelope(&bad).is_err());
    bad = e;
    bad.payload = "{}".into();
    assert!(t.open_envelope(&bad).is_err());
}
#[test]
fn catalogue_regression_is_rejected() {
    let (t, mut c, key) = fixture();
    let previous = envelope(&c, &key);
    c.published_at = "2020-01-01T00:00:00Z".into();
    assert!(accept_catalog(&t, &envelope(&c, &key), &previous).is_err());
}
#[test]
fn package_size_hash_signature_and_product_binding() {
    let (t, c, key) = fixture();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("package");
    fs::write(&path, b"package fixture").unwrap();
    let mut p = c.apps[0].releases[0].assets[1].clone();
    p.size = fs::metadata(&path).unwrap().len();
    p.sha256 = storage::digest(&path).unwrap();
    p.signature = STANDARD.encode(
        key.sign(p.signed_message(PRODUCT, "0.10.0").as_bytes())
            .to_bytes(),
    );
    verify_package(&t, &p, "0.10.0", &path).unwrap();
    assert!(verify_package(&t, &p, "0.11.0", &path).is_err());
    assert!(p.verify_signature(&t, "other", "0.10.0").is_err());
    fs::write(&path, b"PACKAGE fixture").unwrap();
    assert!(verify_package(&t, &p, "0.10.0", &path).is_err());
    fs::write(&path, b"short").unwrap();
    assert!(verify_package(&t, &p, "0.10.0", &path).is_err());
}
#[test]
fn origins_credentials_http_and_redirect_destinations_are_restricted() {
    let t = trust().unwrap();
    for url in [
        "http://github.com/a",
        "https://evil.example/a",
        "https://github.com.evil.example/a",
        "https://user:pass@github.com/a",
        "https://github.com:8080/a",
    ] {
        assert!(t.check_url(url).is_err(), "{url}");
    }
    t.check_url("https://release-assets.githubusercontent.com/a")
        .unwrap();
}
#[test]
fn managed_lock_is_shared_with_launcher() {
    let dir = tempfile::tempdir().unwrap();
    let held = storage::acquire_lock(dir.path()).unwrap();
    assert!(storage::acquire_lock(dir.path()).is_err());
    drop(held);
    storage::acquire_lock(dir.path()).unwrap();
}
#[test]
fn helper_cannot_read_requests_outside_its_private_directory() {
    assert!(run_helper(Path::new("/tmp/not-an-update.json")).is_err());
}
#[test]
fn receipt_requires_actual_version_and_exact_installation() {
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("application");
    write_receipt(dir.path(), "0.10.0", &exe, "installed", "done").unwrap();
    assert!(read_receipt(dir.path(), "0.9.0", &exe)
        .unwrap()
        .contains("0.9.0"));
    assert!(read_receipt(dir.path(), "0.10.0", &dir.path().join("copy"))
        .unwrap()
        .contains("Última"));
    assert!(read_receipt(dir.path(), "0.10.0", &exe)
        .unwrap()
        .contains("confirmada"));
    write_receipt(dir.path(), "0.10.0", &exe, "installing", "not finished").unwrap();
    assert!(!read_receipt(dir.path(), "0.10.0", &exe)
        .unwrap()
        .contains("confirmada"));
}
#[test]
fn cleanup_is_not_recursive_and_preserves_user_files() {
    let dir = tempfile::tempdir().unwrap();
    let stage = dir.path().join("stage-owned");
    fs::create_dir(&stage).unwrap();
    fs::write(stage.join(package_name()), b"partial").unwrap();
    fs::write(stage.join("user.txt"), b"keep").unwrap();
    cleanup(&stage);
    assert_eq!(fs::read(stage.join("user.txt")).unwrap(), b"keep");
    assert!(!stage.join(package_name()).exists());
}
#[test]
fn oversized_or_invalid_local_state_is_rejected() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("state");
    fs::write(&p, "not JSON").unwrap();
    assert!(limited_json::<DiskState>(&p, 5000).is_err());
    fs::write(&p, vec![0; 5001]).unwrap();
    assert!(limited_json::<DiskState>(&p, 5000).is_err());
}
#[cfg(target_os = "linux")]
#[test]
fn standalone_appimage_adapter_preserves_location_and_previous_file() {
    let (_, c, _) = fixture();
    let d = tempfile::tempdir().unwrap();
    let exe = d.path().join("Armadura.AppImage");
    let source = d.path().join("new");
    fake_appimage(&exe, 1);
    let old = fs::read(&exe).unwrap();
    let old_digest = storage::digest(&exe).unwrap();
    fake_appimage(&source, 2);
    let mut p = c.apps[0].releases[0].assets[1].clone();
    p.sha256 = storage::digest(&source).unwrap();
    p.size = 80;
    let i = Installation {
        mode: "appimage".into(),
        executable: exe.clone(),
        managed_root: None,
    };
    install_independent(&source, &i, &p).unwrap();
    assert_eq!(fs::read(&exe).unwrap(), fs::read(source).unwrap());
    assert_eq!(fs::read(backup_path(&exe, &old_digest)).unwrap(), old);
}
#[cfg(target_os = "linux")]
#[test]
fn managed_adapter_keeps_old_version_and_owner_marker() {
    let (_, c, _) = fixture();
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("source");
    fake_appimage(&source, 1);
    let p = &c.apps[0].releases[0].assets[1];
    let mut p = p.clone();
    p.sha256 = storage::digest(&source).unwrap();
    let a = platform::install(&source, d.path(), &c.apps[0], "0.9.0", &p).unwrap();
    let first = fs::read(&a).unwrap();
    fake_appimage(&source, 2);
    p.sha256 = storage::digest(&source).unwrap();
    let b = platform::install(&source, d.path(), &c.apps[0], "0.10.0", &p).unwrap();
    assert_ne!(a, b);
    assert_eq!(fs::read(&a).unwrap(), first);
    assert!(d
        .path()
        .join(PRODUCT)
        .join(".openstruct-managed.json")
        .is_file());
}
#[cfg(unix)]
#[test]
fn package_and_destination_symlinks_are_rejected() {
    use std::os::unix::fs::symlink;
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("source");
    fake_appimage(&source, 1);
    let link = d.path().join("link");
    symlink(&source, &link).unwrap();
    let i = Installation {
        mode: "appimage".into(),
        executable: link,
        managed_root: None,
    };
    assert!(validate_destination(&i).is_err());
}
#[tokio::test]
async fn development_cannot_download_or_install() {
    let d = tempfile::tempdir().unwrap();
    let i = Installation {
        mode: "development".into(),
        executable: std::env::current_exe().unwrap(),
        managed_root: None,
    };
    let u = Updater::new(d.path().into(), i, "0.5.0".into()).unwrap();
    assert!(u.prepare("9.0.0").await.is_err());
    assert!(u.arm("9.0.0").await.is_err());
    assert!(u.authorize_exit("9.0.0").is_err());
}

#[test]
fn package_key_cannot_be_used_as_catalog_root() {
    let (t, c, key) = fixture();
    let good = envelope(&c, &key);
    let mut bad = good.clone();
    bad.key_id = "test-only".into();
    assert!(accept_catalog(&t, &bad, &good).is_err());
}

#[cfg(target_os = "linux")]
#[test]
fn previous_copy_collision_does_not_overwrite_user_file() {
    let (_, c, _) = fixture();
    let d = tempfile::tempdir().unwrap();
    let exe = d.path().join("Armadura.AppImage");
    let source = d.path().join("new");
    fake_appimage(&exe, 1);
    fake_appimage(&source, 2);
    let old = fs::read(&exe).unwrap();
    let backup = backup_path(&exe, &storage::digest(&exe).unwrap());
    fs::write(&backup, b"user data").unwrap();
    let mut p = c.apps[0].releases[0].assets[1].clone();
    p.sha256 = storage::digest(&source).unwrap();
    let i = Installation {
        mode: "appimage".into(),
        executable: exe.clone(),
        managed_root: None,
    };
    assert!(install_independent(&source, &i, &p).is_err());
    assert_eq!(fs::read(exe).unwrap(), old);
    assert_eq!(fs::read(backup).unwrap(), b"user data");
}
#[cfg(target_os = "linux")]
#[test]
fn previous_appimage_can_be_restored_after_failed_version_confirmation() {
    let (_, c, _) = fixture();
    let d = tempfile::tempdir().unwrap();
    let exe = d.path().join("Armadura.AppImage");
    let source = d.path().join("new");
    fake_appimage(&exe, 1);
    fake_appimage(&source, 2);
    let old = fs::read(&exe).unwrap();
    let digest = storage::digest(&exe).unwrap();
    let mut p = c.apps[0].releases[0].assets[1].clone();
    p.sha256 = storage::digest(&source).unwrap();
    let i = Installation {
        mode: "appimage".into(),
        executable: exe.clone(),
        managed_root: None,
    };
    install_independent(&source, &i, &p).unwrap();
    restore_previous(&exe, &digest).unwrap();
    assert_eq!(fs::read(exe).unwrap(), old);
}
/// Explicit CI-only smoke test of the actual built NSIS/AppImage, never a user installation.
#[test]
#[ignore = "requires an isolated CI runner and a freshly built native package"]
fn native_adapter_real_package() {
    assert_eq!(
        std::env::var("CI").as_deref(),
        Ok("true"),
        "Run only on an isolated CI runner"
    );
    assert_eq!(
        std::env::var("OPENSTRUCT_NATIVE_SANDBOX").as_deref(),
        Ok("1")
    );
    let source = PathBuf::from(std::env::var_os("OPENSTRUCT_TEST_PACKAGE").expect("package"));
    let version = std::env::var("OPENSTRUCT_TEST_VERSION").expect("version");
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("native update with spaces");
    fs::create_dir(&dir).unwrap();
    let (_, c, key) = fixture();
    let mut t = trust().unwrap();
    t.keys.insert(
        "test-only".into(),
        STANDARD.encode(key.verifying_key().to_bytes()),
    );
    let mut p = c.apps[0].releases[0]
        .assets
        .iter()
        .find(|p| p.platform == std::env::consts::OS)
        .unwrap()
        .clone();
    p.size = fs::metadata(&source).unwrap().len();
    p.sha256 = storage::digest(&source).unwrap();
    p.signature = STANDARD.encode(
        key.sign(p.signed_message(PRODUCT, &version).as_bytes())
            .to_bytes(),
    );
    verify_package(&t, &p, &version, &source).unwrap();
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        let exe = dir.join("Armadura.AppImage");
        fake_appimage(&exe, 1);
        let old = storage::digest(&exe).unwrap();
        let i = Installation {
            mode: "appimage".into(),
            executable: exe.clone(),
            managed_root: None,
        };
        install_independent(&source, &i, &p).unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();
        confirm_product(&exe, &version).unwrap();
        assert!(backup_path(&exe, &old).exists());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // First create an actual per-user installation in the sandbox, then exercise its update adapter.
        let status = Command::new(&source)
            .args(["/S", "/CURRENTUSER", "/NORESTART"])
            .raw_arg(format!("/D={}", dir.display()))
            .status()
            .unwrap();
        assert!(status.success());
        let exe = dir.join("armadurastruct.exe");
        assert!(registered_nsis(&exe).unwrap());
        confirm_product(&exe, &version).unwrap();
        let i = Installation {
            mode: "nsis".into(),
            executable: exe.clone(),
            managed_root: None,
        };
        let result =
            install_independent(&source, &i, &p).and_then(|_| confirm_product(&exe, &version));
        let _ = Command::new(dir.join("uninstall.exe")).arg("/S").status();
        result.unwrap();
    }
    // Exercise the same locked inventory transaction used by the production
    // helper, using a second real package installation and only temporary data.
    let apps = root.path().join("managed apps");
    fs::create_dir(&apps).unwrap();
    let apps = dunce::canonicalize(apps).unwrap();
    let exe = platform::install(&source, &apps, &c.apps[0], &version, &p).unwrap();
    let exe = dunce::canonicalize(exe).unwrap();
    let project_file = apps.join(PRODUCT).join("project-preserved.fixture");
    fs::write(&project_file, b"user project unchanged").unwrap();
    let old = Installed {
        app_id: PRODUCT.into(),
        name: "ArmaduraStruct".into(),
        version: version.clone(),
        kind: p.kind.clone(),
        root: apps.to_string_lossy().into(),
        executable: exe.to_string_lossy().into(),
        executable_sha256: storage::digest(&exe).unwrap(),
        installed_at: Utc::now().to_rfc3339(),
        present: true,
        modified: false,
        previous_version: None,
    };
    let data = root.path().join("launcher data");
    let state_path = data.join("state.json");
    let mut other = old.clone();
    other.app_id = "other-test-product".into();
    let raw = serde_json::json!({
        "schemaVersion":1,
        "settings": {"theme":"dark","language":"pt-BR","channel":"stable","checkOnStart":true,"installRoot":apps,"catalogUrl":null,"hiddenApps":[]},
        "inventory": {(PRODUCT): old, "other-test-product":other},
        "jobs":[],
        "futureLauncherField":{"preserve":true}
    });
    let request = Request {
        schema_version: 1,
        product: PRODUCT.into(),
        version: version.clone(),
        previous_version: version.clone(),
        installation: Installation {
            mode: "managed".into(),
            executable: exe.clone(),
            managed_root: Some(apps.clone()),
        },
        envelope: bundled().unwrap(),
        nonce: "only-in-test".into(),
        previous_digest: storage::digest(&exe).unwrap(),
    };
    let selection = Selection {
        version: version.clone(),
        release: c.apps[0].releases[0].clone(),
        package: p,
    };
    let held = storage::acquire_lock(&data).unwrap();
    storage::atomic_json(&state_path, &raw).unwrap();
    assert!(install_managed(&data, &source, &request, &selection, &c).is_err());
    drop(held);
    let result = install_managed(&data, &source, &request, &selection, &c);
    let (updated, _) = result.as_ref().unwrap();
    confirm_product(updated, &version).unwrap();
    let held = storage::acquire_lock(&data).unwrap();
    let saved: serde_json::Value = limited_json(&state_path, 5_000_000).unwrap();
    assert_eq!(saved["settings"], raw["settings"]);
    assert_eq!(saved["jobs"], raw["jobs"]);
    assert_eq!(
        saved["inventory"]["other-test-product"],
        raw["inventory"]["other-test-product"]
    );
    assert_eq!(saved["futureLauncherField"], raw["futureLauncherField"]);
    let item: Installed = serde_json::from_value(saved["inventory"][PRODUCT].clone()).unwrap();
    assert_eq!(item.version, version);
    assert_eq!(item.root, old.root);
    platform::checked_executable(&item).unwrap();
    assert_eq!(fs::read(project_file).unwrap(), b"user project unchanged");
    drop(held);
    #[cfg(target_os = "windows")]
    let _ = Command::new(apps.join(PRODUCT).join("uninstall.exe"))
        .arg("/S")
        .status();
}

#[tokio::test]
async fn catalogue_http_errors_json_and_size_limits() {
    for (status, body) in [
        (404, b"missing".to_vec()),
        (500, b"server error".to_vec()),
        (200, b"not JSON".to_vec()),
        (200, vec![b' '; MAX_CATALOG + 1]),
    ] {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://{}", server.server_addr());
        let thread = std::thread::spawn(move || {
            if let Some(request) = server.recv_timeout(Duration::from_secs(3)).unwrap() {
                let _ =
                    request.respond(tiny_http::Response::from_data(body).with_status_code(status));
            }
        });
        let response = reqwest::Client::new().get(url).send().await.unwrap();
        assert!(envelope_response(response).await.is_err());
        thread.join().unwrap();
    }
}
#[tokio::test]
async fn http_redirect_to_untrusted_origin_is_refused() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.server_addr());
    let thread = std::thread::spawn(move || {
        if let Some(request) = server.recv_timeout(Duration::from_secs(3)).unwrap() {
            let _ = request.respond(
                tiny_http::Response::empty(302).with_header(
                    tiny_http::Header::from_bytes(
                        "Location",
                        "https://not-openstruct.invalid/package",
                    )
                    .unwrap(),
                ),
            );
        }
    });
    // HTTP loopback is only a response fixture. Production checks the fixed HTTPS URL before sending.
    let result = client(&trust().unwrap(), 2).unwrap().get(url).send().await;
    assert!(result.is_err());
    thread.join().unwrap();
}
#[tokio::test]
async fn stalled_request_has_a_finite_timeout() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.server_addr());
    let thread = std::thread::spawn(move || {
        if let Some(_request) = server.recv_timeout(Duration::from_secs(3)).unwrap() {
            std::thread::sleep(Duration::from_millis(1400));
        }
    });
    let error = client(&trust().unwrap(), 1)
        .unwrap()
        .get(url)
        .send()
        .await
        .unwrap_err();
    assert!(error.is_timeout());
    thread.join().unwrap();
}
#[tokio::test]
async fn cancelling_before_response_headers_does_not_wait_for_server_timeout() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.server_addr());
    let thread = std::thread::spawn(move || {
        if let Some(_request) = server.recv_timeout(Duration::from_secs(3)).unwrap() {
            std::thread::sleep(Duration::from_millis(1400));
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let updater = Updater::new(
        dir.path().into(),
        Installation {
            mode: "development".into(),
            executable: std::env::current_exe().unwrap(),
            managed_root: None,
        },
        "0.5.0".into(),
    )
    .unwrap();
    let cancel = updater.clone();
    let task = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel.cancel().unwrap();
    });
    let error = tokio::time::timeout(
        Duration::from_secs(1),
        updater.download_response(reqwest::Client::new().get(url)),
    )
    .await
    .expect("Cancellation must not wait for the server")
    .unwrap_err();
    assert!(error.to_string().contains("cancelado"));
    task.await.unwrap();
    thread.join().unwrap();
}
#[test]
fn valid_signature_does_not_make_invalid_json_or_schema_acceptable() {
    let (t, c, key) = fixture();
    for payload in ["{".to_owned(), "{}".to_owned(), {
        let mut v = serde_json::to_value(&c).unwrap();
        v["schemaVersion"] = 99.into();
        v.to_string()
    }] {
        let signature = STANDARD.encode(key.sign(payload.as_bytes()).to_bytes());
        let bad = Envelope {
            payload,
            signature,
            key_id: "catalog-v1".into(),
        };
        assert!(t.open_envelope(&bad).is_err());
    }
}
