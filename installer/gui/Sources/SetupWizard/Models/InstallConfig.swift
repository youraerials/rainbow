import SwiftUI
import Foundation

class InstallConfig: ObservableObject {
    @Published var subdomain = ""
    @Published var useCustomDomain = false
    @Published var customDomain = ""

    @Published var cloudflareToken = ""
    @Published var cloudflareZoneId = ""

    @Published var adminName = ""
    @Published var adminEmail = ""

    @Published var enableImmich = true
    @Published var enableStalwart = true
    @Published var enableCryptpad = true
    @Published var enableSeafile = true
    @Published var enableJellyfin = true
    @Published var enableMinecraft = false

    @Published var uploadPath = ""
    @Published var mediaPath = ""

    var domain: String {
        useCustomDomain ? customDomain : "\(subdomain).rainbow.rocks"
    }

    /// Write config to rainbow.yaml
    func writeConfig() throws {
        let installDir = "/opt/rainbow"
        let configPath = "\(installDir)/config/rainbow.yaml"

        let yaml = """
        rainbow:
          version: "0.1.0"

        domain:
          primary: "\(domain)"

        cloudflare:
          zone_id: "\(cloudflareZoneId)"
          tunnel_id: ""

        admin:
          name: "\(adminName)"
          email: "\(adminEmail)"

        services:
          postgres:
            version: "17"
          redis:
            version: "7"
          caddy: {}
          cloudflared: {}
          authentik:
            enabled: true
          immich:
            enabled: \(enableImmich)
            upload_path: "\(uploadPath.isEmpty ? "./infrastructure/immich/upload" : uploadPath)"
            enable_ml: true
          stalwart:
            enabled: \(enableStalwart)
            data_path: "/opt/rainbow/stalwart"
            domains:
              - "\(domain)"
          cryptpad:
            enabled: \(enableCryptpad)
          seafile:
            enabled: \(enableSeafile)
          jellyfin:
            enabled: \(enableJellyfin)
            media_paths:
              - "~/Movies"
              - "~/Music"
          minecraft:
            enabled: \(enableMinecraft)
            memory: "4G"
            server_name: "Rainbow MC"
            max_players: 20

        backups:
          enabled: true
          schedule: "0 3 * * *"
          repository: ""
          retention:
            keep_daily: 7
            keep_weekly: 4
            keep_monthly: 6

        ai:
          enabled: true
          model: "claude-sonnet-4-20250514"
        """

        try yaml.write(toFile: configPath, atomically: true, encoding: .utf8)
    }

    /// Store secrets in macOS Keychain
    func storeSecrets() {
        storeInKeychain(service: "rainbow-cloudflare-tunnel-token", password: cloudflareToken)

        // Generate random passwords for services
        storeInKeychain(service: "rainbow-postgres-password", password: randomPassword())
        storeInKeychain(service: "rainbow-authentik-secret", password: randomPassword(length: 64))
        storeInKeychain(service: "rainbow-authentik-bootstrap-password", password: randomPassword())
        storeInKeychain(service: "rainbow-stalwart-admin-password", password: randomPassword())
        storeInKeychain(service: "rainbow-seafile-admin-password", password: randomPassword())
    }

    private func storeInKeychain(service: String, password: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        process.arguments = [
            "add-generic-password",
            "-s", service,
            "-a", "rainbow",
            "-w", password,
            "-U"
        ]
        try? process.run()
        process.waitUntilExit()
    }

    private func randomPassword(length: Int = 32) -> String {
        let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return String((0..<length).map { _ in chars.randomElement()! })
    }
}
