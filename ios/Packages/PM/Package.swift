// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PM",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "PMKit", targets: ["PMKit"]),
        .library(name: "PMStore", targets: ["PMStore"]),
        .library(name: "PMLive", targets: ["PMLive"]),
        .library(name: "PMDesign", targets: ["PMDesign"]),
        .library(name: "PMCamera", targets: ["PMCamera"]),
        .library(name: "PMPreview", targets: ["PMPreview"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .target(name: "PMKit"),
        .target(name: "PMStore", dependencies: ["PMKit", .product(name: "GRDB", package: "GRDB.swift")]),
        .target(name: "PMLive", dependencies: ["PMKit", "PMStore", .product(name: "GRDB", package: "GRDB.swift")]),
        .target(name: "PMDesign", dependencies: ["PMKit"], resources: [.copy("Fonts")]),
        .target(name: "PMCamera", dependencies: ["PMKit"]),
        .target(name: "PMPreview", dependencies: ["PMKit", "PMDesign"]),
        .target(name: "PMTestSupport", dependencies: ["PMKit", "PMStore", "PMLive"], path: "Tests/PMTestSupport"),
        .testTarget(name: "PMKitTests", dependencies: ["PMKit", "PMTestSupport"]),
        .testTarget(name: "PMStoreTests", dependencies: ["PMStore", "PMTestSupport"]),
        .testTarget(name: "PMLiveTests", dependencies: ["PMLive", "PMStore", "PMTestSupport"]),
    ]
)
