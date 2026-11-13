//! Embeds the Windows PE version block, application manifest, and icon.
//!
//! Why this matters beyond cosmetics: an anonymous binary with no publisher,
//! no version, and no declared execution level scores worse under antivirus
//! heuristics than an identified one, and several vendor submission portals
//! reject a sample that carries no version metadata at all.

use std::env;

fn main() {
    println!("cargo:rerun-if-changed=app.manifest");
    println!("cargo:rerun-if-env-changed=ORCA_LAUNCHER_VERSION");
    println!("cargo:rerun-if-env-changed=ORCA_LAUNCHER_ICON");
    println!("cargo:rerun-if-env-changed=ORCA_LAUNCHER_FILENAME");
    println!("cargo:rerun-if-changed=../../src/shared/app-brand.json");

    // Forks rename the app executable and CLI; read the shared brand file so the launcher finds them.
    let brand_path = std::path::Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../src/shared/app-brand.json");
    let brand = std::fs::read_to_string(&brand_path).unwrap_or_default();
    let app_exe = brand_string(&brand, "exeName")
        .map(|name| format!("{name}.exe"))
        .unwrap_or_else(|| "Orca.exe".into());
    println!("cargo:rustc-env=ORCA_APP_EXE_NAME={app_exe}");
    let cli_command = brand_string(&brand, "cliCommandName").unwrap_or_else(|| "orca".into());
    println!("cargo:rustc-env=ORCA_CLI_COMMAND_NAME={cli_command}");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    // Set by config/scripts/build-windows-cli-launcher.mjs from package.json, so
    // the launcher always reports the release it shipped in.
    let version = env::var("ORCA_LAUNCHER_VERSION")
        .expect("ORCA_LAUNCHER_VERSION must be set; build through build-windows-cli-launcher.mjs");
    let (major, minor, patch) = numeric_version_parts(&version);

    let product_name = brand_string(&brand, "productName").unwrap_or_else(|| "Orca".into());
    let mut resource = winresource::WindowsResource::new();
    resource.set("ProductName", &product_name);
    resource.set("FileDescription", &format!("{product_name} CLI Launcher"));
    resource.set("CompanyName", "Stably AI");
    resource.set(
        "LegalCopyright",
        "Copyright (C) Stably AI. All rights reserved.",
    );
    let filename = env::var("ORCA_LAUNCHER_FILENAME").unwrap_or_else(|_| "orca.exe".into());
    resource.set("InternalName", &filename);
    resource.set("OriginalFilename", &filename);
    resource.set("FileVersion", &format!("{major}.{minor}.{patch}.0"));
    resource.set("ProductVersion", &version);
    resource.set_version_info(
        winresource::VersionInfo::FILEVERSION,
        (major << 48) | (minor << 32) | (patch << 16),
    );
    resource.set_version_info(
        winresource::VersionInfo::PRODUCTVERSION,
        (major << 48) | (minor << 32) | (patch << 16),
    );
    resource.set_manifest_file("app.manifest");
    if let Ok(icon) = env::var("ORCA_LAUNCHER_ICON") {
        resource.set_icon(&icon);
    }
    resource
        .compile()
        .expect("failed to compile Windows resources");
}

/// Reads a top-level string field from app-brand.json without a JSON dependency.
fn brand_string(brand: &str, key: &str) -> Option<String> {
    let start = brand.find(&format!("\"{key}\""))? + key.len() + 2;
    let rest = brand[start..].trim_start().strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Strips any prerelease or build suffix; the PE numeric version accepts digits only.
fn numeric_version_parts(version: &str) -> (u64, u64, u64) {
    let base = version.split(['-', '+']).next().unwrap_or_default();
    let mut parts = base.split('.').map(|part| part.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}
