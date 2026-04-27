import SwiftUI

struct ReviewView: View {
    @EnvironmentObject var config: InstallConfig
    @StateObject private var installer = Installer()

    var enabledServices: [String] {
        var services: [String] = ["Auth (Authentik)"]
        if config.enableImmich { services.append("Photos (Immich)") }
        if config.enableStalwart { services.append("Email (Stalwart)") }
        if config.enableCryptpad { services.append("Docs (CryptPad)") }
        if config.enableSeafile { services.append("Files (Seafile)") }
        if config.enableJellyfin { services.append("Media (Jellyfin)") }
        if config.enableMinecraft { services.append("Minecraft") }
        return services
    }

    var body: some View {
        VStack(spacing: 24) {
            if installer.isComplete {
                completionView
            } else if installer.progress > 0 {
                progressView
            } else {
                reviewView
            }
        }
        .padding(32)
        .navigationTitle("Review")
    }

    var reviewView: some View {
        VStack(spacing: 24) {
            Text("Review & Install")
                .font(.title2.bold())

            VStack(alignment: .leading, spacing: 12) {
                reviewRow("Domain", config.domain)
                reviewRow("Admin", "\(config.adminName) <\(config.adminEmail)>")
                reviewRow("Services", enabledServices.joined(separator: ", "))
            }
            .padding()
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)

            Spacer()

            HStack {
                NavigationLink("Back") { ServicesView() }
                    .buttonStyle(.bordered)
                Spacer()
                Button("Install") {
                    Task {
                        await installer.install(config: config)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.indigo)
                .controlSize(.large)
            }
        }
    }

    var progressView: some View {
        VStack(spacing: 20) {
            Text("Installing...")
                .font(.title2.bold())

            ProgressView(value: installer.progress)
                .progressViewStyle(.linear)

            Text(installer.currentStep)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if let error = installer.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding()
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(8)
            }

            Spacer()
        }
    }

    var completionView: some View {
        VStack(spacing: 20) {
            Text("Setup Complete!")
                .font(.title2.bold())
                .foregroundStyle(.green)

            Text("Your Rainbow server is running.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 8) {
                Text("Access your services:")
                    .font(.headline)
                linkRow("Dashboard", "https://app.\(config.domain)")
                linkRow("Photos", "https://photos.\(config.domain)")
                linkRow("Email", "https://mail.\(config.domain)")
                linkRow("Files", "https://files.\(config.domain)")
            }
            .padding()
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)

            Spacer()

            Button("Open Dashboard") {
                NSWorkspace.shared.open(URL(string: "https://app.\(config.domain)")!)
            }
            .buttonStyle(.borderedProminent)
            .tint(.indigo)
            .controlSize(.large)
        }
    }

    func reviewRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.headline)
                .frame(width: 80, alignment: .trailing)
            Text(value)
                .font(.body)
                .foregroundStyle(.secondary)
        }
    }

    func linkRow(_ label: String, _ url: String) -> some View {
        HStack {
            Text(label).font(.body)
            Spacer()
            Text(url)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.indigo)
        }
    }
}
