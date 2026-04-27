import SwiftUI

struct WelcomeView: View {
    @EnvironmentObject var config: InstallConfig

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Text("rainbow")
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundStyle(.indigo)

            Text("Take back your digital life")
                .font(.title3)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 8) {
                featureRow("Photos & Videos", "Self-hosted photo management with AI search")
                featureRow("Email & Calendar", "Your own email server with full calendar support")
                featureRow("File Sharing", "Sync and share files across all your devices")
                featureRow("Documents", "Collaborative editing with end-to-end encryption")
                featureRow("Media Server", "Stream your movies and music anywhere")
                featureRow("AI Integration", "Build custom apps with Claude")
            }
            .padding()
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)

            Spacer()

            NavigationLink("Get Started") {
                DomainView()
            }
            .buttonStyle(.borderedProminent)
            .tint(.indigo)
            .controlSize(.large)
        }
        .padding(32)
        .navigationTitle("Welcome")
    }

    func featureRow(_ title: String, _ description: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(.indigo.opacity(0.2))
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(description).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
