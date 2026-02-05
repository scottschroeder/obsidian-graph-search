use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
use toml_edit::{value, DocumentMut};
use walkdir::WalkDir;

const MANIFEST_PATH: &str = "manifest.json";
const CARGO_TOML_PATH: &str = "Cargo.toml";
const PACKAGE_JSON_PATH: &str = "package.json";
const VERSIONS_JSON_PATH: &str = "versions.json";
const PKG_DIR: &str = "pkg";
const WASM_OUT_NAME: &str = "obsidian_rust_plugin";
const SRC_HASH_FILE: &str = "src_hash.txt";
const WASM_FILES: [&str; 6] = [
    "obsidian_rust_plugin_bg.wasm",
    "obsidian_rust_plugin.js",
    "obsidian_rust_plugin.d.ts",
    "package.json",
    "README.md",
    "LICENSE",
];

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    match (args.next().as_deref(), args.next().as_deref()) {
        (Some("version"), Some("check")) => {
            if args.next().is_some() {
                bail!("Unexpected arguments. Usage: cargo xtask version check");
            }
            version_check()
        }
        (Some("version"), Some("bump")) => {
            let version = args
                .next()
                .ok_or_else(|| anyhow!("Missing version. Usage: cargo xtask version bump X.Y.Z"))?;
            if args.next().is_some() {
                bail!("Unexpected arguments. Usage: cargo xtask version bump X.Y.Z");
            }
            version_bump(&version)
        }
        (Some("wasm"), Some("build")) => {
            if args.next().is_some() {
                bail!("Unexpected arguments. Usage: cargo xtask wasm build");
            }
            wasm_build()
        }
        (Some("wasm"), Some("check")) => {
            if args.next().is_some() {
                bail!("Unexpected arguments. Usage: cargo xtask wasm check");
            }
            wasm_check()
        }
        _ => {
            bail!(
                "Usage:\n  cargo xtask version check\n  cargo xtask version bump X.Y.Z\n  cargo xtask wasm build\n  cargo xtask wasm check"
            );
        }
    }
}

fn wasm_build() -> Result<()> {
    run_wasm_pack(PKG_DIR)?;
    remove_optional_wasm_dts(PKG_DIR);
    write_src_hash(PKG_DIR)?;
    Ok(())
}

fn wasm_check() -> Result<()> {
    let pkg_dir = Path::new(PKG_DIR);
    let mut missing = Vec::new();
    for file in WASM_FILES {
        let path = pkg_dir.join(file);
        if !path.exists() {
            missing.push(file);
        }
    }
    let hash_path = pkg_dir.join(SRC_HASH_FILE);
    if !hash_path.exists() {
        missing.push(SRC_HASH_FILE);
    }
    if !missing.is_empty() {
        bail!("WASM artifacts missing in pkg: {}", missing.join(", "));
    }

    let expected = read_src_hash(PKG_DIR)?;
    let actual = compute_src_hash()?;
    if expected != actual {
        bail!(
            "WASM source hash mismatch. Run `cargo xtask wasm build` and commit pkg/*. Expected {}, got {}",
            expected,
            actual
        );
    }

    Ok(())
}

fn run_wasm_pack(out_dir: &str) -> Result<()> {
    let status = Command::new("wasm-pack")
        .args([
            "build",
            "--target",
            "web",
            "--out-dir",
            out_dir,
            "--out-name",
            WASM_OUT_NAME,
            "--release",
        ])
        .status()
        .with_context(|| "Run wasm-pack")?;
    if !status.success() {
        bail!("wasm-pack failed with status {}", status);
    }
    Ok(())
}

fn remove_optional_wasm_dts<P: AsRef<Path>>(dir: P) {
    let path = dir.as_ref().join("obsidian_rust_plugin_bg.wasm.d.ts");
    let _ = fs::remove_file(path);
}

fn write_src_hash(dir: &str) -> Result<()> {
    let hash = compute_src_hash()?;
    let path = Path::new(dir).join(SRC_HASH_FILE);
    fs::write(&path, format!("{}\n", hash)).with_context(|| format!("Write {}", path.display()))?;
    Ok(())
}

fn read_src_hash(dir: &str) -> Result<String> {
    let path = Path::new(dir).join(SRC_HASH_FILE);
    let content = fs::read_to_string(&path).with_context(|| format!("Read {}", path.display()))?;
    Ok(content.trim().to_string())
}

fn compute_src_hash() -> Result<String> {
    let mut files = Vec::new();
    for entry in WalkDir::new("src").into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            files.push(path.to_path_buf());
        }
    }
    files.push(PathBuf::from("Cargo.toml"));
    files.push(PathBuf::from("Cargo.lock"));
    files.push(PathBuf::from("xtask/Cargo.toml"));
    files.push(PathBuf::from("xtask/src/main.rs"));

    files.sort();

    let mut hasher = Sha256::new();
    for path in files {
        let bytes = fs::read(&path).with_context(|| format!("Read {}", path.display()))?;
        let path_str = path
            .to_str()
            .ok_or_else(|| anyhow!("Non-utf8 path in hash inputs"))?;
        hasher.update(path_str.as_bytes());
        hasher.update([0u8]);
        hasher.update(&bytes);
        hasher.update([0u8]);
    }

    let digest = hasher.finalize();
    Ok(format!("{:x}", digest))
}

fn version_check() -> Result<()> {
    let manifest = read_json(MANIFEST_PATH)?;
    let package = read_json(PACKAGE_JSON_PATH)?;
    let versions = read_json(VERSIONS_JSON_PATH)?;
    let cargo_version = read_cargo_version(CARGO_TOML_PATH)?;

    let manifest_version = json_string(&manifest, "version")?;
    let min_app_version = json_string(&manifest, "minAppVersion")?;
    let package_version = json_string(&package, "version")?;

    ensure_semver("manifest.json", &manifest_version)?;
    ensure_semver("package.json", &package_version)?;
    ensure_semver("Cargo.toml", &cargo_version)?;

    if manifest_version != package_version {
        bail!(
            "Version mismatch: manifest.json ({}) != package.json ({})",
            manifest_version,
            package_version
        );
    }

    if manifest_version != cargo_version {
        bail!(
            "Version mismatch: manifest.json ({}) != Cargo.toml ({})",
            manifest_version,
            cargo_version
        );
    }

    let versions_obj = versions
        .as_object()
        .ok_or_else(|| anyhow!("versions.json must contain a JSON object"))?;

    let versions_min = versions_obj
        .get(&manifest_version)
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            anyhow!(
                "versions.json must include version {} mapped to minAppVersion",
                manifest_version
            )
        })?;

    if versions_min != min_app_version {
        bail!(
            "versions.json has minAppVersion {} for {}, expected {}",
            versions_min,
            manifest_version,
            min_app_version
        );
    }

    Ok(())
}

fn version_bump(version: &str) -> Result<()> {
    ensure_semver("version argument", version)?;

    let mut manifest = read_json(MANIFEST_PATH)?;
    let min_app_version = json_string(&manifest, "minAppVersion")?;
    set_json_string(&mut manifest, "version", version)?;
    write_json(MANIFEST_PATH, &manifest)?;

    let mut package = read_json(PACKAGE_JSON_PATH)?;
    set_json_string(&mut package, "version", version)?;
    write_json(PACKAGE_JSON_PATH, &package)?;

    let mut versions = read_json(VERSIONS_JSON_PATH)?;
    let versions_obj = versions
        .as_object_mut()
        .ok_or_else(|| anyhow!("versions.json must contain a JSON object"))?;
    versions_obj.insert(version.to_string(), Value::String(min_app_version));
    write_json(VERSIONS_JSON_PATH, &versions)?;

    write_cargo_version(CARGO_TOML_PATH, version)?;

    Ok(())
}

fn ensure_semver(source: &str, version: &str) -> Result<()> {
    if is_semver(version) {
        Ok(())
    } else {
        bail!("{} version must be X.Y.Z, got {}", source, version)
    }
}

fn is_semver(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts
        .iter()
        .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

fn read_json(path: &str) -> Result<Value> {
    let content = fs::read_to_string(path).with_context(|| format!("Read {}", path))?;
    let value = serde_json::from_str(&content).with_context(|| format!("Parse {}", path))?;
    Ok(value)
}

fn json_string(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| anyhow!("Missing or invalid {} in JSON", key))
}

fn set_json_string(value: &mut Value, key: &str, new_value: &str) -> Result<()> {
    let obj = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("Expected JSON object when setting {}", key))?;
    obj.insert(key.to_string(), Value::String(new_value.to_string()));
    Ok(())
}

fn write_json(path: &str, value: &Value) -> Result<()> {
    let pretty = serde_json::to_string_pretty(value)?;
    let mut output = String::new();
    for (idx, line) in pretty.lines().enumerate() {
        if idx > 0 {
            output.push('\n');
        }
        let mut spaces = 0usize;
        for ch in line.chars() {
            if ch == ' ' {
                spaces += 1;
            } else {
                break;
            }
        }
        let tabs = "\t".repeat(spaces / 2);
        output.push_str(&tabs);
        output.push_str(&line[spaces..]);
    }
    output.push('\n');
    fs::write(path, output).with_context(|| format!("Write {}", path))?;
    Ok(())
}

fn read_cargo_version(path: &str) -> Result<String> {
    let content = fs::read_to_string(path).with_context(|| format!("Read {}", path))?;
    let doc = content
        .parse::<DocumentMut>()
        .with_context(|| format!("Parse {}", path))?;
    doc["package"]["version"]
        .as_str()
        .map(|value| value.to_string())
        .ok_or_else(|| anyhow!("Missing package.version in Cargo.toml"))
}

fn write_cargo_version(path: &str, version: &str) -> Result<()> {
    let content = fs::read_to_string(path).with_context(|| format!("Read {}", path))?;
    let mut doc = content
        .parse::<DocumentMut>()
        .with_context(|| format!("Parse {}", path))?;
    doc["package"]["version"] = value(version);
    fs::write(path, doc.to_string()).with_context(|| format!("Write {}", path))?;
    Ok(())
}
