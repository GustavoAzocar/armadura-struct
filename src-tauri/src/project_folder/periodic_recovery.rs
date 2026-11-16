use super::{directory, location, msg, names, MAIN, PREVIOUS, SEQ};
use cap_std::fs::{Dir, File, OpenOptions};
use same_file::Handle;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::TryLockError,
    io::{self, ErrorKind, Write},
    path::PathBuf,
    sync::atomic::Ordering,
};

const DIRECTORY: &str = "recovery-v1";
const ARCHIVE: &str = "copies.json";
const LOCK: &str = ".copies.lock";
const FORMAT: &str = "armstruct-periodic-recovery/1";

#[derive(serde::Deserialize)]
struct ProjectIdentity {
    id: String,
    schema: String,
}

fn recovery_dir(root: &Dir, create: bool) -> Result<Option<Dir>, String> {
    names(root, DIRECTORY)?;
    match root.open_dir(DIRECTORY) {
        Ok(d) => Ok(Some(d)),
        Err(error) if error.kind() == ErrorKind::NotFound && !create => Ok(None),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            if let Err(error) = root.create_dir(DIRECTORY) {
                if error.kind() != ErrorKind::AlreadyExists {
                    return Err(msg(error));
                }
            }
            names(root, DIRECTORY)?;
            root.open_dir(DIRECTORY).map(Some).map_err(msg)
        }
        Err(error) => Err(msg(error)),
    }
}

fn project_id(root: &Dir, write: bool) -> Result<Option<String>, String> {
    let Some(save) = directory(root, false)? else {
        return Ok(None);
    };
    let sources: &[&str] = if write { &[MAIN] } else { &[MAIN, PREVIOUS] };
    for &source in sources {
        names(&save, source)?;
        let raw = match regular_text(&save, source) {
            Ok(Some(raw)) => raw,
            Ok(None) => continue,
            Err(error) if error.kind() == ErrorKind::InvalidData => continue,
            Err(error) => return Err(msg(error)),
        };
        if let Ok(project) = serde_json::from_str::<ProjectIdentity>(&raw) {
            if project.schema.starts_with("armadurastruct/") && !project.id.is_empty() {
                return Ok(Some(project.id));
            }
        }
    }
    Ok(None)
}

fn validate_archive(raw: &str, owner: Option<&str>) -> Result<(), String> {
    let archive: Value = serde_json::from_str(raw)
        .map_err(|_| "Arquivo de recuperação ilegível; o conteúdo foi preservado.")?;
    let Some(project) = archive["projectId"].as_str().filter(|id| !id.is_empty()) else {
        return Err("Arquivo de recuperação sem projeto identificado.".into());
    };
    if owner.is_some_and(|expected| project != expected) {
        return Err("Arquivo de recuperação pertence a outro projeto.".into());
    }
    let Some(copies) = archive["copies"].as_array() else {
        return Err("Lista de cópias da pasta ilegível.".into());
    };
    if archive["format"].as_str() != Some(FORMAT) {
        return Err("Formato do arquivo de recuperação não reconhecido.".into());
    }
    let mut ids = HashSet::new();
    for copy in copies {
        let id = copy["id"].as_str();
        if !id.is_some_and(|id| !id.is_empty() && ids.insert(id))
            || copy["projectId"].as_str() != Some(project)
            || !copy["name"].is_string()
            || copy["startedAt"].as_u64().is_none()
            || copy["copiedAt"].as_u64().is_none()
            || !copy["raw"].is_string()
        {
            return Err("Metadados do arquivo de recuperação incompatíveis.".into());
        }
        // Um snapshot ilegível ainda pode ser consultado para diagnóstico.
        // O leitor nativo do documento valida o JSON contido em raw.
    }
    Ok(())
}

fn regular_text(dir: &Dir, name: &str) -> io::Result<Option<String>> {
    match dir.symlink_metadata(name) {
        Ok(metadata) if metadata.is_file() => dir.read_to_string(name).map(Some),
        Ok(_) => Err(io::Error::new(
            ErrorKind::InvalidInput,
            format!("Nome administrado não é um arquivo regular: {name}"),
        )),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn archive_bytes(dir: &Dir) -> Result<Option<String>, String> {
    names(dir, ARCHIVE)?;
    regular_text(dir, ARCHIVE).map_err(msg)
}

pub(super) fn read(path: &PathBuf, root: &Dir) -> Result<Option<String>, String> {
    location(path, root)?;
    let Some(dir) = recovery_dir(root, false)? else {
        return Ok(None);
    };
    let owner = project_id(root, false)?;
    let archive = archive_bytes(&dir)?;
    if let Some(raw) = &archive {
        validate_archive(raw, owner.as_deref())?;
    }
    Ok(archive)
}

fn temporary(dir: &Dir) -> Result<(String, File), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    for _ in 0..16 {
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let name = format!(".copies-{}-{seq}.tmp", std::process::id());
        match dir.open_with(&name, &options) {
            Ok(file) => return Ok((name, file)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(msg(error)),
        }
    }
    Err("Não foi possível criar temporário exclusivo de recuperação.".into())
}

fn same_directory(root: &Dir, dir: &Dir) -> Result<bool, String> {
    let Some(current) = recovery_dir(root, false)? else {
        return Ok(false);
    };
    let current = Handle::from_file(current.into_std_file()).map_err(msg)?;
    let observed = Handle::from_file(dir.try_clone().map_err(msg)?.into_std_file()).map_err(msg)?;
    Ok(current == observed)
}

pub(super) fn write(
    path: &PathBuf,
    root: &Dir,
    data: &str,
    expected: Option<&str>,
) -> Result<bool, String> {
    location(path, root)?;
    let owner = project_id(root, true)?.ok_or("Projeto principal ilegível ou ausente.")?;
    validate_archive(data, Some(&owner))?;
    let dir = recovery_dir(root, true)?.ok_or("Pasta de recuperação indisponível.")?;
    // Recuse conteúdo alheio antes de criar a trava ou um temporário.
    let old = archive_bytes(&dir)?;
    if let Some(raw) = &old {
        validate_archive(raw, Some(&owner))?;
    }
    if old.as_deref() != expected {
        return Ok(false);
    }
    drop(old);
    names(&dir, LOCK)?;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    let lock = dir.open_with(LOCK, &options).map_err(msg)?.into_std();
    let metadata = lock.metadata().map_err(msg)?;
    if !metadata.is_file() || metadata.len() != 0 {
        return Err("Nome da trava de recuperação ocupado por outro arquivo.".into());
    }
    match lock.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return Ok(false),
        Err(TryLockError::Error(error)) => return Err(msg(error)),
    }
    if archive_bytes(&dir)?.as_deref() != expected {
        return Ok(false);
    }

    let (name, mut file) = temporary(&dir)?;
    let identity = Handle::from_file(file.try_clone().map_err(msg)?.into_std()).map_err(msg)?;
    let written = file.write_all(data.as_bytes()).and_then(|()| file.sync_all());
    drop(file);

    let result = (|| {
        written.map_err(msg)?;
        location(path, root)?;
        if !same_directory(root, &dir)? || project_id(root, true)?.as_deref() != Some(owner.as_str()) {
            return Err("Pasta de recuperação ou projeto substituído durante a gravação.".into());
        }
        if archive_bytes(&dir)?.as_deref() != expected {
            return Ok(false);
        }
        names(&dir, LOCK)?;
        let held = Handle::from_file(lock.try_clone().map_err(msg)?).map_err(msg)?;
        let current = Handle::from_file(dir.open(LOCK).map_err(msg)?.into_std()).map_err(msg)?;
        if held != current {
            return Ok(false);
        }
        if !same_temporary(&dir, &name, &identity) {
            return Err("Temporário de recuperação mudou durante a gravação.".into());
        }

        // Um único rename dentro da mesma pasta publica a cópia e a rotação.
        // O inventário anterior permanece intacto se preparar ou publicar falhar.
        dir.rename(&name, &dir, ARCHIVE).map_err(msg)?;
        Ok(true)
    })();
    if !matches!(result, Ok(true)) && same_temporary(&dir, &name, &identity) {
        // Remova somente o temporário desta operação; órfãos de outras operações
        // e arquivos desconhecidos permanecem para inspeção.
        drop(identity);
        let _ = dir.remove_file(&name);
    }
    result
}

fn same_temporary(dir: &Dir, name: &str, identity: &Handle) -> bool {
    names(dir, name).is_ok()
        && dir
            .open(name)
            .ok()
            .and_then(|file| Handle::from_file(file.into_std()).ok())
            .is_some_and(|current| &current == identity)
}
