use crate::contract::{parse_json, safe_path, validate_manifest};
use anyhow::{ensure, Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Cursor, Read},
};

pub const MAX_PACKAGE: usize = 16 * 1024 * 1024;
pub const MAX_EXPANDED: u64 = 64 * 1024 * 1024;
pub fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn u16at(b: &[u8], i: usize) -> Result<usize> {
    Ok(u16::from_le_bytes(b.get(i..i + 2).context("ZIP truncado")?.try_into()?) as usize)
}
fn u32at(b: &[u8], i: usize) -> Result<usize> {
    Ok(u32::from_le_bytes(b.get(i..i + 4).context("ZIP truncado")?.try_into()?) as usize)
}
// zip::ZipArchive indexes by name and can hide duplicate central entries. Validate
// the small portable ZIP subset before using the library for decompression/CRC.
fn envelope(b: &[u8]) -> Result<usize> {
    ensure!(
        b.len() >= 22 && b.len() <= MAX_PACKAGE,
        "Pacote deve ter até 16 MiB"
    );
    let end = b.len() - 22;
    ensure!(
        &b[end..end + 4] == b"PK\x05\x06" && u16at(b, end + 20)? == 0,
        "ZIP sem comentários/ZIP64 requerido"
    );
    ensure!(
        u16at(b, end + 4)? == 0 && u16at(b, end + 6)? == 0,
        "ZIP multipartes recusado"
    );
    let count = u16at(b, end + 10)?;
    ensure!(
        count > 0 && count <= 256 && count == u16at(b, end + 8)?,
        "Limite de 256 arquivos"
    );
    let start = u32at(b, end + 16)?;
    ensure!(
        start.checked_add(u32at(b, end + 12)?) == Some(end),
        "Diretório ZIP inválido"
    );
    let mut p = start;
    let mut local = 0;
    let mut names = HashSet::new();
    for _ in 0..count {
        ensure!(
            b.get(p..p + 4) == Some(b"PK\x01\x02"),
            "Cabeçalho ZIP inválido"
        );
        let n = u16at(b, p + 28)?;
        let extra = u16at(b, p + 30)?;
        let comment = u16at(b, p + 32)?;
        ensure!(
            extra == 0 && comment == 0 && u16at(b, p + 34)? == 0,
            "Entradas ZIP com extras/comentários recusadas"
        );
        let raw = b.get(p + 46..p + 46 + n).context("Nome ZIP truncado")?;
        let name = std::str::from_utf8(raw)?;
        safe_path(name)?;
        ensure!(
            names.insert(name.to_ascii_lowercase()),
            "Entradas ZIP duplicadas/ambíguas"
        );
        ensure!(
            u32at(b, p + 42)? == local && b.get(local..local + 4) == Some(b"PK\x03\x04"),
            "ZIP sobreposto/fora de ordem"
        );
        let flags = u16at(b, p + 8)?;
        let compression = u16at(b, p + 10)?;
        ensure!(
            flags & !0x800 == 0 && [0, 8].contains(&compression),
            "ZIP criptografado/streaming/compressão sem suporte"
        );
        ensure!(
            u16at(b, local + 6)? == flags
                && u16at(b, local + 8)? == compression
                && b.get(local + 14..local + 26) == b.get(p + 16..p + 28),
            "Cabeçalho local diverge do diretório ZIP"
        );
        ensure!(
            u16at(b, local + 26)? == n
                && u16at(b, local + 28)? == 0
                && b.get(local + 30..local + 30 + n) == Some(raw),
            "Caminho local ZIP divergente"
        );
        local = local
            .checked_add(30 + n)
            .and_then(|v| v.checked_add(u32at(b, p + 20).ok()?))
            .context("ZIP excede limites")?;
        ensure!(local <= start, "ZIP sobreposto");
        p += 46 + n;
    }
    ensure!(p == end && local == start, "Dados extras/ambíguos no ZIP");
    for name in &names {
        let mut prefix = String::new();
        let parts: Vec<_> = name.split('/').collect();
        for part in &parts[..parts.len() - 1] {
            prefix.push_str(part);
            ensure!(!names.contains(&prefix), "Arquivo colide com diretório");
            prefix.push('/');
        }
    }
    Ok(count)
}
pub fn inspect(bytes: &[u8]) -> Result<Value> {
    let count = envelope(bytes)?;
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).context("ZIP inválido")?;
    ensure!(zip.len() == count && zip.offset() == 0, "ZIP ambíguo");
    let mut total = 0u64;
    // First pass bounds every allocation, even when the manifest comes last.
    for i in 0..zip.len() {
        let f = zip.by_index(i)?;
        ensure!(
            !f.is_symlink() && !f.is_dir() && !f.encrypted(),
            "Links/diretórios/criptografia recusados"
        );
        ensure!(
            f.unix_mode()
                .is_none_or(|m| m & 0o170000 == 0 || m & 0o170000 == 0o100000),
            "Tipo de arquivo ZIP recusado"
        );
        ensure!(
            f.size() <= MAX_PACKAGE as u64 && f.size() <= f.compressed_size().max(1) * 100,
            "Expansão ZIP desproporcional"
        );
        total = total.checked_add(f.size()).context("ZIP excede limites")?;
        ensure!(total <= MAX_EXPANDED, "Expansão ZIP maior que 64 MiB");
    }
    let mut raw = Vec::new();
    let f = zip
        .by_name("manifest.json")
        .context("manifest.json deve estar na raiz")?;
    ensure!(f.size() <= 128 * 1024, "Manifesto maior que 128 KiB");
    let manifest_size = f.size();
    f.take(128 * 1024 + 1).read_to_end(&mut raw)?;
    ensure!(
        raw.len() as u64 == manifest_size && raw.len() <= 128 * 1024,
        "Expansão real do manifesto divergente"
    );
    let manifest = parse_json(&raw)?;
    validate_manifest(&manifest)?;
    let files = manifest["files"].as_object().unwrap();
    ensure!(
        files.len() + 1 == count,
        "Arquivos não declarados/ausentes no manifesto"
    );
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        if f.name() == "manifest.json" {
            continue;
        }
        let expected = files
            .get(f.name())
            .context("Arquivo não declarado no manifesto")?;
        ensure!(
            expected["size"].as_u64() == Some(f.size()),
            "Tamanho do arquivo divergente"
        );
        let mut data = Vec::new();
        let size = f.size();
        (&mut f).take(size + 1).read_to_end(&mut data)?; // Includes zip's CRC validation.
        ensure!(
            data.len() as u64 == size && sha256(&data) == expected["sha256"].as_str().unwrap(),
            "Integridade SHA-256 divergente"
        );
    }
    Ok(manifest)
}
