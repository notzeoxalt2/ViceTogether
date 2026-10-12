#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod assets;
use assets::{read_json, write_json};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    process::{Child, Command},
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
struct Backend {
    settings: Value,
    library: PathBuf,
    profile: PathBuf,
    child: Option<Child>,
}
type Shared = Arc<Mutex<Backend>>;
fn detected() -> Vec<Value> {
    let mut found = Vec::new();
    for drive in ["C", "D", "E", "F"] {
        for suffix in [
            "games/Grand Theft Auto Vice City",
            "games/GTA Vice City",
            "SteamLibrary/steamapps/common/Grand Theft Auto Vice City",
        ] {
            let path = PathBuf::from(format!("{drive}:/{suffix}"));
            if assets::valid_game(&path) {
                found.push(json!({"root":path,"valid":true,"missing":[]}))
            }
        }
    }
    found
}
fn from_code(input: &str) -> Result<Value, String> {
    let code: String = input
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    let alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    if code.len() != 10 || !code.chars().all(|c| alphabet.contains(c)) {
        return Err("Enter the ten-character room code your friend shared.".into());
    }
    let derive = |context: &str| {
        let hash = Sha256::digest(format!("ViceTogether/code/v2/{context}/{code}").as_bytes());
        URL_SAFE_NO_PAD.encode(&hash[..16])
    };
    Ok(
        json!({"v":2,"code":format!("{}-{}",&code[..5],&code[5..]),"room":derive("room"),"key":derive("key"),"host":null}),
    )
}
fn parse_invite(input: &str) -> Result<Value, String> {
    if input.len() > 2048 {
        return Err("Invitation is too long".into());
    }
    let input = input.trim();
    if let Some(code) = input.strip_prefix("vicetogether://join/") {
        return from_code(code);
    }
    if input.contains(":") || input.contains('#') {
        return Err("This Rust preview accepts short room codes and short invite links. Legacy links still need the Electron build.".into());
    }
    from_code(input)
}
fn executable(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("native/reVC.exe");
    if bundled.is_file() {
        return Ok(bundled);
    }
    if cfg!(debug_assertions) {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../engine/native/reVC.exe");
        if dev.is_file() {
            return Ok(dev);
        }
    }
    Err("The native game engine is missing from this build.".into())
}
fn dispatch(
    app: tauri::AppHandle,
    shared: Shared,
    operation: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    if operation == "window-action" {
        let window = app
            .get_webview_window("main")
            .ok_or("Launcher window is unavailable")?;
        match args.first().and_then(Value::as_str) {
            Some("minimize") => window.minimize(),
            Some("maximize") => {
                if window.is_maximized().map_err(|e| e.to_string())? {
                    window.unmaximize()
                } else {
                    window.maximize()
                }
            }
            Some("close") => window.close(),
            _ => return Err("Unsupported window action".into()),
        }
        .map_err(|e| e.to_string())?;
        return Ok(json!(true));
    }
    if operation == "verification-result" {
        let output =
            std::env::var_os("VT_RUST_VERIFY_OUTPUT").ok_or("Verification is not enabled")?;
        let result = args.first().ok_or("Missing verification result")?;
        write_json(&PathBuf::from(output), result)?;
        return Ok(json!(true));
    }
    let mut state = shared.lock().map_err(|_| "Launcher state is unavailable")?;
    let arg = |index: usize| args.get(index).unwrap_or(&Value::Null).clone();
    match operation.as_str() {
        "init" => Ok(
            json!({"settings":state.settings,"detected":detected(),"games":[{"id":"vice-city","title":"Grand Theft Auto: Vice City","mod":"ViceTogether","status":"Rust preview","description":"Private sessions in 1986 Vice City.","minimumPlayers":2,"maximumPlayers":8,"singleplayer":true,"multiplayer":"migration-pending","assetSetup":"Import your original PC game once"}],"activeGameId":"vice-city","assets":assets::status(&state.library),"engineBuilt":executable(&app).is_ok(),"invite":null,"config":{"iceServers":[],"inviteBaseUrl":null,"updateFeedUrl":null},"version":"0.3.0-alpha.4 · Rust preview","selfTest":false,"capabilities":{"nativeMultiplayer":false},"backend":"rust","verification":std::env::var_os("VT_RUST_VERIFY_OUTPUT").is_some()}),
        ),
        "prepare-bundled" => Ok(Value::Null),
        "import-game" => {
            let source = if let Some(index) = arg(0).as_u64() {
                detected()
                    .get(index as usize)
                    .and_then(|v| v["root"].as_str())
                    .map(PathBuf::from)
            } else {
                rfd::FileDialog::new()
                    .set_title("Choose your original Vice City folder")
                    .pick_folder()
            };
            match source {
                Some(source) => assets::import(&app, &state.library, &source),
                None => Ok(Value::Null),
            }
        }
        "repair" => assets::repair(&app, &state.library),
        "settings" => {
            let value = arg(0);
            let name = value["name"].as_str().ok_or("Enter a player name")?.trim();
            let fps = value["fps"].as_u64().ok_or("Select a frame rate")?;
            let sensitivity = value["mouseSensitivity"]
                .as_f64()
                .ok_or("Select mouse sensitivity")?;
            if name.chars().count() > 24
                || ![0, 30, 60, 120, 144, 240].contains(&fps)
                || !(0.25..=4.0).contains(&sensitivity)
                || !value["fullscreen"].is_boolean()
            {
                return Err("These settings are not valid".into());
            }
            state.settings = json!({"name":if name.is_empty(){"Player"}else{name},"fps":fps,"fullscreen":value["fullscreen"],"mouseSensitivity":sensitivity,"libraryRoot":state.library});
            write_json(&state.profile.join("settings.json"), &state.settings)?;
            Ok(state.settings.clone())
        }
        "invite-create" => {
            let mut random = [0u8; 10];
            rand::rngs::OsRng.fill_bytes(&mut random);
            let alphabet = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            let code: String = random
                .iter()
                .map(|b| alphabet[(b & 31) as usize] as char)
                .collect();
            from_code(&code)
        }
        "invite-parse" => parse_invite(arg(0).as_str().ok_or("Paste your invitation")?),
        "copy-text" => {
            let value = arg(0);
            let text = value.as_str().ok_or("Missing text")?;
            if text.len() > 2048 { return Err("Text is too long to copy".into()); }
            arboard::Clipboard::new().map_err(|e| e.to_string())?.set_text(text).map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "invite-copy" | "invite-code-copy" => {
            let invite = arg(0);
            let canonical = from_code(invite["code"].as_str().ok_or("Invalid invitation")?)?;
            if invite["room"] != canonical["room"] || invite["key"] != canonical["key"] {
                return Err("Invalid invitation".into());
            }
            let text = if operation == "invite-copy" {
                format!(
                    "vicetogether://join/{}",
                    canonical["code"].as_str().unwrap()
                )
            } else {
                canonical["code"].as_str().unwrap().to_owned()
            };
            arboard::Clipboard::new()
                .map_err(|e| e.to_string())?
                .set_text(text)
                .map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "play" => {
            if arg(0).as_bool().unwrap_or(false) {
                return Err("The Rust multiplayer bridge is still being migrated. Use the working Electron prototype for game sessions.".into());
            }
            if !assets::status(&state.library)["gameReady"]
                .as_bool()
                .unwrap_or(false)
            {
                return Err("Import your original Vice City folder first.".into());
            }
            if let Some(child) = state.child.as_mut() {
                if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                    return Err("Vice City is already running.".into());
                }
            }
            let root = state.library.join("game");
            let native = executable(&app)?;
            let target = assets::safe_path(&root, "ViceTogether-engine.exe")?;
            std::fs::copy(native, &target).map_err(|e| e.to_string())?;
            let saves = state.profile.join("saves");
            std::fs::create_dir_all(&saves).map_err(|e| e.to_string())?;
            let mut command = Command::new(target);
            command
                .current_dir(root)
                .env("VT_USER_DIR", saves)
                .env("VT_FPS", state.settings["fps"].to_string())
                .env(
                    "VT_FULLSCREEN",
                    if state.settings["fullscreen"].as_bool().unwrap_or(true) {
                        "1"
                    } else {
                        "0"
                    },
                )
                .env(
                    "VT_MOUSE_SENSITIVITY",
                    state.settings["mouseSensitivity"].to_string(),
                );
            for key in [
                "VT_PORT",
                "VT_AUTOSTART",
                "VT_WORLD_HOST",
                "VT_FOLLOW_PLAYER",
                "VT_TEST_WALK",
                "VT_TEST_CAR",
                "VT_TEST_CAR_BLAST",
                "VT_TEST_WORLD_EFFECTS",
                "VT_INPUT_DISABLED",
                "VT_MUTE",
                "VT_TEST_COMBAT",
                "VT_TEST_GUN",
                "VT_TEST_GUN_WALK",
                "VT_TEST_SHOTS",
                "VT_TEST_JUMP",
            ] {
                command.env_remove(key);
            }
            state.child = Some(
                command
                    .spawn()
                    .map_err(|e| format!("Vice City could not start: {e}"))?,
            );
            Ok(json!(true))
        }
        "updates" => {
            Ok(json!({"message":"This Rust migration preview has no published update feed."}))
        }
        "quit" => {
            app.exit(0);
            Ok(json!(true))
        }
        _ => Err("This feature has not been migrated to the Rust preview yet.".into()),
    }
}
#[tauri::command]
async fn desktop_request(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    operation: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || dispatch(app, shared, operation, args))
        .await
        .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let profile = app.path().app_data_dir()?;
            let settings_path = profile.join("settings.json");
            let mut settings = read_json(&settings_path);
            if !settings.is_object() {
                settings =
                    json!({"name":"Player","fps":144,"fullscreen":true,"mouseSensitivity":1.5})
            }
            let library = std::env::var_os("VT_RUST_LIBRARY")
                .map(PathBuf::from)
                .or_else(|| settings["libraryRoot"].as_str().map(PathBuf::from))
                .unwrap_or_else(|| profile.join("library"));
            app.manage(Arc::new(Mutex::new(Backend {
                settings,
                library,
                profile,
                child: None,
            })));
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(monitors) = window.available_monitors() {
                    let primary = window.primary_monitor()?.map(|m| *m.position());
                    if let Some(monitor) = monitors.iter().find(|m| Some(*m.position()) != primary)
                    {
                        let position = monitor.position();
                        let _ = window.set_position(tauri::PhysicalPosition::new(
                            position.x + 24,
                            position.y + 24,
                        ));
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![desktop_request])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut state) = window.state::<Shared>().lock() {
                    if let Some(child) = state.child.as_mut() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("ViceTogether could not start");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn room_codes_match_existing_launcher() {
        let invite = from_code("K7M4P-9Q2RX").unwrap();
        assert_eq!(invite["room"], "H4wFwjTXpql711t0iE0fIA");
        assert_eq!(invite["key"], "xkgPiAZz8x6KuTee5CY8gA");
        assert_eq!(
            parse_invite("vicetogether://join/K7M4P-9Q2RX").unwrap(),
            invite
        );
        assert!(from_code("AAAAAAAAAI").is_err());
        assert!(parse_invite("https://example.com/mod.exe").is_err());
    }
}
