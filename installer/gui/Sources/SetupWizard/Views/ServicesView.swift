import SwiftUI

struct ServicesView: View {
    @EnvironmentObject var config: InstallConfig

    var body: some View {
        VStack(spacing: 24) {
            Text("Choose Services")
                .font(.title2.bold())

            Text("Select which services to enable. You can always change this later in rainbow.yaml.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            VStack(spacing: 1) {
                serviceToggle("Photos & Videos (Immich)", isOn: $config.enableImmich,
                              description: "AI-powered photo management with mobile app")
                serviceToggle("Email & Calendar (Stalwart)", isOn: $config.enableStalwart,
                              description: "Full email server with CalDAV/CardDAV")
                serviceToggle("Documents (CryptPad)", isOn: $config.enableCryptpad,
                              description: "End-to-end encrypted collaborative editing")
                serviceToggle("File Sharing (Seafile)", isOn: $config.enableSeafile,
                              description: "Fast file sync with desktop and mobile clients")
                serviceToggle("Media Server (Jellyfin)", isOn: $config.enableJellyfin,
                              description: "Stream movies and music with hardware transcoding")
                serviceToggle("Minecraft Server", isOn: $config.enableMinecraft,
                              description: "Paper game server (uses 4GB+ additional RAM)")
            }
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)

            Spacer()

            HStack {
                NavigationLink("Back") { CloudflareView() }
                    .buttonStyle(.bordered)
                Spacer()
                NavigationLink("Next") { ReviewView() }
                    .buttonStyle(.borderedProminent)
                    .tint(.indigo)
            }
        }
        .padding(32)
        .navigationTitle("Services")
    }

    func serviceToggle(_ title: String, isOn: Binding<Bool>, description: String) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body)
                Text(description).font(.caption).foregroundStyle(.secondary)
            }
        }
        .toggleStyle(.switch)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
