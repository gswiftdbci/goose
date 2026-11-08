// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "goose-webui-server",
    platforms: [.macOS(.v13), .linux],
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", from: "4.99.0"),
        .package(url: "https://github.com/vapor/websocket-kit.git", from: "2.15.0"),
    ],
    targets: [
        .executableTarget(
            name: "goose-webui-server",
            dependencies: [
                .product(name: "Vapor", package: "vapor"),
                .product(name: "WebSocketKit", package: "websocket-kit"),
            ]
        )
    ]
)
