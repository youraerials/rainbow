import SwiftUI

struct DomainView: View {
    @EnvironmentObject var config: InstallConfig

    var body: some View {
        VStack(spacing: 24) {
            Text("Choose Your Domain")
                .font(.title2.bold())

            Picker("Domain Type", selection: $config.useCustomDomain) {
                Text("rainbow.rocks subdomain").tag(false)
                Text("Custom domain").tag(true)
            }
            .pickerStyle(.segmented)

            if config.useCustomDomain {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your domain:")
                        .font(.headline)
                    TextField("example.com", text: $config.customDomain)
                        .textFieldStyle(.roundedBorder)
                    Text("You must add this domain to Cloudflare and point its nameservers.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Choose a subdomain:")
                        .font(.headline)
                    HStack {
                        TextField("yourname", text: $config.subdomain)
                            .textFieldStyle(.roundedBorder)
                        Text(".rainbow.rocks")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !config.domain.isEmpty && config.domain != ".rainbow.rocks" {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your services will be at:")
                        .font(.subheadline.bold())
                    Group {
                        Text("photos.\(config.domain)")
                        Text("mail.\(config.domain)")
                        Text("files.\(config.domain)")
                        Text("docs.\(config.domain)")
                        Text("media.\(config.domain)")
                    }
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                }
                .padding()
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(8)
            }

            Spacer()

            HStack {
                NavigationLink("Back") { WelcomeView() }
                    .buttonStyle(.bordered)
                Spacer()
                NavigationLink("Next") { CloudflareView() }
                    .buttonStyle(.borderedProminent)
                    .tint(.indigo)
                    .disabled(config.domain.isEmpty || config.domain == ".rainbow.rocks")
            }
        }
        .padding(32)
        .navigationTitle("Domain")
    }
}
