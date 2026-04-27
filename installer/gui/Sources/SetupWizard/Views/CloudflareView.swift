import SwiftUI

struct CloudflareView: View {
    @EnvironmentObject var config: InstallConfig
    @State private var validating = false
    @State private var validationResult: String?

    var body: some View {
        VStack(spacing: 24) {
            Text("Cloudflare Setup")
                .font(.title2.bold())

            Text("Cloudflare handles DNS and creates a secure tunnel to your Mac Mini. No ports need to be opened on your router.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("API Token")
                        .font(.headline)
                    SecureField("Enter your Cloudflare API token", text: $config.cloudflareToken)
                        .textFieldStyle(.roundedBorder)
                    Text("Create at: dash.cloudflare.com/profile/api-tokens")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Zone ID")
                        .font(.headline)
                    TextField("Your Cloudflare Zone ID", text: $config.cloudflareZoneId)
                        .textFieldStyle(.roundedBorder)
                    Text("Found on your domain's overview page in Cloudflare dashboard.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let result = validationResult {
                    Text(result)
                        .font(.caption)
                        .foregroundStyle(result.contains("Valid") ? .green : .red)
                }
            }

            Spacer()

            HStack {
                NavigationLink("Back") { DomainView() }
                    .buttonStyle(.bordered)
                Spacer()
                NavigationLink("Next") { ServicesView() }
                    .buttonStyle(.borderedProminent)
                    .tint(.indigo)
                    .disabled(config.cloudflareToken.isEmpty)
            }
        }
        .padding(32)
        .navigationTitle("Cloudflare")
    }
}
