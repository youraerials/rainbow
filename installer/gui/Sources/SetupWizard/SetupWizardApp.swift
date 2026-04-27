import SwiftUI

@main
struct SetupWizardApp: App {
    @StateObject private var config = InstallConfig()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                WelcomeView()
            }
            .environmentObject(config)
            .frame(width: 640, height: 500)
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentSize)
    }
}
