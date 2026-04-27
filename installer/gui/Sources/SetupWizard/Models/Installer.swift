import Foundation

class Installer: ObservableObject {
    @Published var currentStep = ""
    @Published var progress: Double = 0
    @Published var isComplete = false
    @Published var error: String?

    func install(config: InstallConfig) async {
        let steps: [(String, () throws -> Void)] = [
            ("Writing configuration...", { try config.writeConfig() }),
            ("Storing secrets in Keychain...", { config.storeSecrets() }),
            ("Generating service configs...", { self.runScript("generate-config.sh") }),
            ("Pulling container images...", { self.runCommand("container-compose", "-f", "/opt/rainbow/infrastructure/docker-compose.yml", "pull") }),
            ("Starting services...", { self.runScript("../cli/rainbow", "start") }),
        ]

        for (i, (description, action)) in steps.enumerated() {
            await MainActor.run {
                self.currentStep = description
                self.progress = Double(i) / Double(steps.count)
            }

            do {
                try action()
            } catch {
                await MainActor.run {
                    self.error = "Failed at step: \(description)\n\(error.localizedDescription)"
                }
                return
            }
        }

        await MainActor.run {
            self.progress = 1.0
            self.currentStep = "Setup complete!"
            self.isComplete = true
        }
    }

    private func runScript(_ script: String, _ args: String...) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["/opt/rainbow/scripts/\(script)"] + args
        process.currentDirectoryURL = URL(fileURLWithPath: "/opt/rainbow")
        try? process.run()
        process.waitUntilExit()
    }

    private func runCommand(_ command: String, _ args: String...) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [command] + args
        try? process.run()
        process.waitUntilExit()
    }
}
