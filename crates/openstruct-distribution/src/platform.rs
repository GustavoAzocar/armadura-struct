use crate::model::{valid_version, Installed, Package, Product};
use crate::storage::{atomic_json, digest, managed_app_dir, reject_symlink};
use anyhow::{bail, ensure, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};

fn owned_dir(root: &Path, id: &str, create: bool) -> Result<PathBuf> {
    let app = managed_app_dir(root, id)?;
    let marker = app.join(".openstruct-managed.json");
    if app.exists() {
        reject_symlink(&marker)?;
        let owner: serde_json::Value = serde_json::from_slice(&fs::read(&marker).context(
            "Esta pasta não pertence ao Struct Launcher; escolha outra pasta de instalação",
        )?)?;
        ensure!(
            owner["appId"].as_str() == Some(id),
            "Identidade da pasta de instalação não confere"
        );
    } else {
        ensure!(create, "Pasta do aplicativo não encontrada");
        fs::create_dir(&app)?;
        atomic_json(
            &marker,
            &serde_json::json!({"appId": id, "schemaVersion": 1}),
        )?;
    }
    Ok(app)
}

pub fn checked_executable(item: &Installed) -> Result<PathBuf> {
    let app = owned_dir(Path::new(&item.root), &item.app_id, false)?;
    let exe = PathBuf::from(&item.executable);
    reject_symlink(&exe)?;
    ensure!(
        exe.is_file(),
        "O executável não foi encontrado; reinstale o aplicativo"
    );
    let actual = exe.canonicalize()?;
    ensure!(
        actual.starts_with(app.canonicalize()?),
        "Executável fora da pasta gerenciada"
    );
    ensure!(
        digest(&actual)? == item.executable_sha256,
        "O executável foi alterado fora do launcher. Reinstale para confirmar sua origem"
    );
    Ok(actual)
}

pub fn is_running(item: &Installed) -> bool {
    #[cfg(target_os = "linux")]
    {
        let expected = format!("APPIMAGE={}", item.executable);
        if let Ok(entries) = fs::read_dir("/proc") {
            for entry in entries.flatten() {
                if !entry
                    .file_name()
                    .to_string_lossy()
                    .bytes()
                    .all(|b| b.is_ascii_digit())
                {
                    continue;
                }
                if let Ok(env) = fs::read(entry.path().join("environ")) {
                    if env
                        .split(|b| *b == 0)
                        .any(|part| part == expected.as_bytes())
                    {
                        return true;
                    }
                }
                if fs::read_link(entry.path().join("exe")).ok().as_deref()
                    == Some(Path::new(&item.executable))
                {
                    return true;
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        let expected = Path::new(&item.executable).canonicalize().ok();
        if expected.is_some()
            && system
                .processes()
                .values()
                .any(|p| p.exe().and_then(|p| p.canonicalize().ok()) == expected)
        {
            return true;
        }
    }
    false
}

pub fn launch(item: &Installed) -> Result<Child> {
    let executable = checked_executable(item)?;
    Command::new(&executable)
        .current_dir(executable.parent().context("Pasta inválida")?)
        .spawn()
        .context("Não foi possível abrir o aplicativo")
}

pub fn install(
    source: &Path,
    root: &Path,
    product: &Product,
    version: &str,
    asset: &Package,
) -> Result<PathBuf> {
    install_mode(source, root, product, version, asset, false)
}

/// Existing installation only: Tauri NSIS /UPDATE preserves user data, startup
/// preferences and shortcuts instead of performing the fresh-install flow.
pub fn install_update(
    source: &Path,
    root: &Path,
    product: &Product,
    version: &str,
    asset: &Package,
) -> Result<PathBuf> {
    install_mode(source, root, product, version, asset, true)
}

fn install_mode(
    source: &Path,
    root: &Path,
    product: &Product,
    version: &str,
    asset: &Package,
    update: bool,
) -> Result<PathBuf> {
    let _ = update;
    ensure!(valid_version(version), "Versão inválida");
    let app = owned_dir(root, &product.id, true)?;
    #[cfg(target_os = "linux")]
    {
        use std::io::Read;
        use std::os::unix::fs::PermissionsExt;
        ensure!(asset.kind == "appimage", "O Linux exige um AppImage");
        let mut header = [0u8; 11];
        fs::File::open(source)?.read_exact(&mut header)?;
        ensure!(
            &header[..4] == b"\x7fELF" && &header[8..11] == b"AI\x02",
            "O pacote não é um AppImage tipo 2"
        );
        let dir = app.join(version);
        reject_symlink(&dir)?;
        fs::create_dir_all(&dir)?;
        let mut staged = tempfile::NamedTempFile::new_in(&dir)?;
        let mut input = fs::File::open(source)?;
        std::io::copy(&mut input, &mut staged)?;
        staged.as_file().sync_all()?;
        ensure!(
            digest(staged.path())? == asset.sha256,
            "A cópia de instalação não confere"
        );
        fs::set_permissions(staged.path(), fs::Permissions::from_mode(0o755))?;
        let target = dir.join(format!("{}.AppImage", product.id));
        reject_symlink(&target)?;
        staged.persist(&target).map_err(|e| e.error)?;
        return Ok(target);
    }
    #[cfg(target_os = "windows")]
    {
        ensure!(asset.kind == "nsis", "O Windows exige um instalador NSIS");
        let relative = asset
            .executable
            .as_deref()
            .filter(|v| crate::model::valid_relative_exe(v))
            .context("Executável Windows inválido")?;
        use std::os::windows::process::CommandExt;
        // NSIS requires /D to be the final, unquoted argument. No command shell is invoked.
        // Only fixed arguments and a locally selected directory reach this process.
        let mut command = Command::new(source);
        command.args(["/S", "/CURRENTUSER", "/NORESTART"]);
        if update {
            command.arg("/UPDATE");
        }
        let status = command
            .raw_arg(format!("/D={}", app.display()))
            .status()
            .context("Falha ao executar o instalador")?;
        ensure!(
            status.success(),
            "O instalador retornou um erro: {:?}",
            status.code()
        );
        let target = app.join(relative);
        reject_symlink(&target)?;
        ensure!(
            target.is_file() && target.canonicalize()?.starts_with(app.canonicalize()?),
            "O instalador terminou sem criar o executável esperado"
        );
        atomic_json(
            &app.join(".openstruct-managed.json"),
            &serde_json::json!({"appId": product.id, "schemaVersion": 1}),
        )?;
        return Ok(target);
    }
    #[allow(unreachable_code)]
    {
        bail!("Sistema não suportado")
    }
}

pub fn uninstall(item: &Installed) -> Result<()> {
    ensure!(!is_running(item), "Feche o aplicativo antes de desinstalar");
    let app = owned_dir(Path::new(&item.root), &item.app_id, false)?;
    #[cfg(target_os = "windows")]
    {
        let uninstaller = app.join("uninstall.exe");
        reject_symlink(&uninstaller)?;
        ensure!(
            uninstaller.is_file(),
            "Desinstalador não encontrado; use os Aplicativos instalados do Windows"
        );
        let status = Command::new(&uninstaller).arg("/S").status()?;
        ensure!(status.success(), "O desinstalador retornou um erro");
        for _ in 0..40 {
            if !Path::new(&item.executable).exists() {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        bail!("A desinstalação ainda não foi confirmada. Confira os Aplicativos instalados do Windows");
    }
    #[cfg(target_os = "linux")]
    {
        fs::remove_dir_all(&app)?;
        if let Some(data) = dirs::data_dir() {
            crate::desktop::remove_app_shortcut(&data, item)?;
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        bail!("Sistema não suportado")
    }
}

pub fn write_shortcut(item: &Installed) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        let data = dirs::data_dir().context("Menu de aplicativos não encontrado")?;
        crate::desktop::write_app_shortcut(&data, item)?;
    }
    let _ = item;
    Ok(())
}

pub fn folder(item: &Installed) -> Result<PathBuf> {
    owned_dir(Path::new(&item.root), &item.app_id, false)
}
