use anyhow::{anyhow, bail, Context, Result};
use serde_json::Value;
use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;
use toml_edit::{value, DocumentMut};

const MANIFEST_PATH: &str = "manifest.json";
const CARGO_TOML_PATH: &str = "Cargo.toml";
const PACKAGE_JSON_PATH: &str = "package.json";
const VERSIONS_JSON_PATH: &str = "versions.json";
const PKG_DIR: &str = "pkg";
const WASM_OUT_NAME: &str = "obsidian_rust_plugin";
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
    Ok(())
}

fn wasm_check() -> Result<()> {
    let check_dir = Path::new("target/wasm-check");
    if check_dir.exists() {
        fs::remove_dir_all(check_dir).with_context(|| "Remove target/wasm-check")?;
    }
    fs::create_dir_all(check_dir).with_context(|| "Create target/wasm-check")?;
    run_wasm_pack(
        check_dir
            .to_str()
            .ok_or_else(|| anyhow!("Invalid check dir"))?,
    )?;
    remove_optional_wasm_dts(check_dir);

    let pkg_dir = Path::new(PKG_DIR);
    let mut mismatches = Vec::new();
    for file in WASM_FILES {
        let expected_path = check_dir.join(file);
        let actual_path = pkg_dir.join(file);
        if !expected_path.exists() {
            mismatches.push(format!("missing in build: {}", file));
            continue;
        }
        if !actual_path.exists() {
            mismatches.push(format!("missing in pkg: {}", file));
            continue;
        }
        let expected = fs::read(&expected_path)
            .with_context(|| format!("Read {}", expected_path.display()))?;
        let actual =
            fs::read(&actual_path).with_context(|| format!("Read {}", actual_path.display()))?;
        if expected != actual {
            mismatches.push(format!("different: {}", file));
        }
    }

    fs::remove_dir_all(check_dir).with_context(|| "Cleanup target/wasm-check")?;

    if !mismatches.is_empty() {
        let details = mismatches.join(", ");
        bail!(
            "WASM artifacts out of date. Run `cargo xtask wasm build` and commit pkg/*. Details: {}",
            details
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
