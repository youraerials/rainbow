// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SetupWizard",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "SetupWizard",
            path: "Sources/SetupWizard"
        ),
    ]
)
