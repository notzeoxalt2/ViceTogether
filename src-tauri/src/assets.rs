use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Emitter};
const ESSENTIAL: [&str; 5] = [
    "models/gta3.img",
    "models/gta3.dir",
    "data/gta_vc.dat",
    "anim/ped.ifp",
    "Mss32.dll",
];
pub fn safe_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    let normalized = name.replace('\\', "/");
    if normalized.is_empty() || normalized.contains(':') || normalized.contains('\0') {
        return Err("Unsafe asset path".into());
    }
    let relative = Path::new(&normalized);
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Unsafe asset path".into());
    }
    let result = root.join(relative);
    if let Some(parent) = result.parent() {
        if parent.exists()
            && !parent
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
        {
            return Err("Asset path leaves the game folder".into());
        }
    }
    if result.exists()
        && fs::symlink_metadata(&result)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Linked assets are not supported".into());
    }
    Ok(result)
}
pub fn read_json(path: &Path) -> Value {
    fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}
pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Missing storage folder")?)
        .map_err(|e| e.to_string())?;
    let temp = path.with_extension("pending.json");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
fn hash(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let size = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if size == 0 {
            break;
        }
        digest.update(&buffer[..size]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
pub fn valid_game(root: &Path) -> bool {
    ESSENTIAL.iter().all(|name| root.join(name).is_file())
}
pub fn status(library: &Path) -> Value {
    let game = library.join("game");
    let manifest = read_json(&game.join("manifest.json"));
    let entries = manifest["files"].as_array();
    let ready = entries.is_some()
        && ESSENTIAL.iter().all(|name| {
            entries.unwrap().iter().any(|entry| {
                entry["path"]
                    .as_str()
                    .is_some_and(|p| p.replace('\\', "/").eq_ignore_ascii_case(name))
                    && safe_path(&game, entry["path"].as_str().unwrap())
                        .ok()
                        .and_then(|p| fs::metadata(p).ok())
                        .is_some_and(|m| Some(m.len()) == entry["size"].as_u64())
            })
        });
    json!({"gameReady":ready,"gameFiles":entries.map_or(0,|e|e.len()),"gameSource":manifest["source"].as_str().unwrap_or(""),"runtimeReady":false,"multiplayerReady":false})
}
fn allowed(name: &Path) -> bool {
    let filename = name
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if filename == "mss32.dll" && name.components().count() == 1 {
        return true;
    }
    if name
        .parent()
        .is_some_and(|p| p.to_string_lossy().eq_ignore_ascii_case("mss"))
        && [
            "mp3dec.asi",
            "mssa3d.m3d",
            "mssa3d2.m3d",
            "mssds3dh.m3d",
            "mssds3ds.m3d",
            "msseax.m3d",
            "msseax3.m3d",
            "mssfast.m3d",
            "mssrsx.m3d",
            "reverb3.flt",
        ]
        .contains(&filename.as_str())
    {
        return true;
    }
    let ext = name
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    [
        "img", "dir", "dat", "zon", "ifp", "txd", "dff", "col", "ipl", "ide", "cfg", "ini", "scm",
        "sc", "gxt", "adf", "wav", "mp3", "mpg", "sdt", "raw", "cache", "txt", "bmp", "png", "jpg",
    ]
    .contains(&ext.as_str())
}
fn collect(root: &Path, prefix: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(root.join(prefix)).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        let relative = prefix.join(entry.file_name());
        if kind.is_dir() {
            collect(root, &relative, files)?
        } else if kind.is_file() && allowed(&relative) {
            files.push(relative)
        }
        if files.len() > 100000 {
            return Err("Select the Vice City installation folder".into());
        }
    }
    Ok(())
}
pub fn import(app: &AppHandle, library: &Path, source: &Path) -> Result<Value, String> {
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    if !valid_game(&source) {
        return Err(
            "This folder is missing original Vice City game files. Select its installation folder."
                .into(),
        );
    }
    fs::create_dir_all(library.join("game")).map_err(|e| e.to_string())?;
    let target = library
        .join("game")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if source.starts_with(&target) || target.starts_with(&source) {
        return Err(
            "Choose the original installation, separate from the cached game folder.".into(),
        );
    }
    let mut files = Vec::new();
    collect(&source, Path::new(""), &mut files)?;
    let mut entries = Vec::new();
    for (index, relative) in files.iter().enumerate() {
        let name = relative.to_string_lossy();
        let from = safe_path(&source, &name)?;
        let to = safe_path(&target, &name)?;
        fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
        let digest = hash(&from)?;
        if hash(&to).ok().as_ref() != Some(&digest) {
            let temp = to.with_extension("vt-part");
            fs::copy(&from, &temp).map_err(|e| format!("Could not cache {}: {e}", name))?;
            fs::rename(temp, &to).map_err(|e| e.to_string())?;
        }
        entries.push(json!({"path":name,"size":fs::metadata(&from).map_err(|e|e.to_string())?.len(),"sha256":digest}));
        let _ = app.emit(
            "progress",
            json!({"phase":"Preparing your files","file":name,"done":index+1,"total":files.len()}),
        );
    }
    write_json(
        &target.join("manifest.json"),
        &json!({"format":1,"type":"game","source":source,"files":entries}),
    )?;
    Ok(status(library))
}
pub fn repair(app: &AppHandle, library: &Path) -> Result<Value, String> {
    let target = library.join("game");
    let manifest = read_json(&target.join("manifest.json"));
    let source = PathBuf::from(
        manifest["source"]
            .as_str()
            .ok_or("Import your game first")?,
    );
    let entries = manifest["files"]
        .as_array()
        .ok_or("Import your game first")?;
    let mut repaired = 0;
    for (index, entry) in entries.iter().enumerate() {
        let name = entry["path"].as_str().ok_or("Invalid asset manifest")?;
        let expected = entry["sha256"].as_str().ok_or("Missing file checksum")?;
        let to = safe_path(&target, name)?;
        let _ = app.emit(
            "progress",
            json!({"phase":"Checking your files","file":name,"done":index+1,"total":entries.len()}),
        );
        if hash(&to).ok().as_deref() != Some(expected) {
            let from = safe_path(&source, name)?;
            if hash(&from)?.as_str() != expected {
                return Err(format!(
                    "Your original copy of {name} changed. Import the game again."
                ));
            }
            fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
            let temp = to.with_extension("vt-part");
            fs::copy(from, &temp).map_err(|e| e.to_string())?;
            fs::rename(temp, to).map_err(|e| e.to_string())?;
            repaired += 1;
        }
    }
    let mut result = status(library);
    result["repaired"] = json!(repaired);
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_manifest_escape() {
        for p in [
            "../outside",
            "F:/game/file",
            "/absolute",
            "models/../../file",
            "models\\..\\bad",
            "a\0b",
        ] {
            assert!(safe_path(Path::new("."), p).is_err(), "{p}")
        }
    }
}
