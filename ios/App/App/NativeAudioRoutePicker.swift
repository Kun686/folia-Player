import AVFoundation
import AVKit
import UIKit
import Capacitor

// NativeAudioRoutePicker.swift — iOS owns output selection; no private button actions or persisted device IDs.
@MainActor final class NativeAudioRoutePicker: UIViewController, UIAdaptivePresentationControllerDelegate {
    let routePicker = AVRoutePickerView()
    let routeLabel = UILabel()
    private let labels: [String: String]
    private var completion: (() -> Void)?
    private var routeObserver: NSObjectProtocol?

    init(labels: [String: String], light: Bool, completion: @escaping () -> Void) throws {
        guard ["title", "hint", "close", "fallback"].allSatisfy({ key in
            guard let value = labels[key] else { return false }
            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf8.count <= 512
        }) else { throw MobileFailure("invalid-audio-route-labels") }
        self.labels = labels; self.completion = completion
        super.init(nibName: nil, bundle: nil)
        overrideUserInterfaceStyle = light ? .light : .dark
        modalPresentationStyle = .pageSheet
        // The sheet's material has its own traits (iOS 26); match them as well as the content.
        sheetPresentationController?.traitOverrides.userInterfaceStyle = overrideUserInterfaceStyle
        sheetPresentationController?.detents = [.medium(), .large()]
        sheetPresentationController?.prefersGrabberVisible = true
    }
    required init?(coder: NSCoder) { return nil }

    static func present(on host: UIViewController, labels: [String: String], light: Bool,
                        completion: @escaping () -> Void) throws {
        guard host.viewIfLoaded?.window != nil, host.presentedViewController == nil,
              !host.isBeingDismissed, !host.isBeingPresented else { throw MobileFailure("audio-route-busy") }
        let picker = try NativeAudioRoutePicker(labels: labels, light: light, completion: completion)
        host.present(picker, animated: true)
        picker.presentationController?.delegate = picker
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let heading = UILabel(); heading.text = labels["title"]
        heading.font = .preferredFont(forTextStyle: .title2); heading.adjustsFontForContentSizeCategory = true
        heading.numberOfLines = 0; heading.accessibilityTraits = .header
        let close = UIButton(type: .system)
        close.setTitle(labels["close"], for: .normal); close.titleLabel?.font = .preferredFont(forTextStyle: .body)
        close.titleLabel?.adjustsFontForContentSizeCategory = true
        close.accessibilityIdentifier = "audio-route-close"
        close.addTarget(self, action: #selector(closeSheet), for: .touchUpInside)
        close.setContentCompressionResistancePriority(.required, for: .horizontal)
        close.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        close.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        let header = UIStackView(arrangedSubviews: [heading, close]); header.spacing = 12; header.alignment = .center
        routeLabel.font = .preferredFont(forTextStyle: .headline); routeLabel.numberOfLines = 0
        routeLabel.adjustsFontForContentSizeCategory = true; routeLabel.accessibilityIdentifier = "audio-route-current"
        let hint = UILabel(); hint.text = labels["hint"]; hint.numberOfLines = 0
        hint.font = .preferredFont(forTextStyle: .body); hint.adjustsFontForContentSizeCategory = true
        hint.textColor = .secondaryLabel
        routePicker.prioritizesVideoDevices = false
        routePicker.accessibilityIdentifier = "audio-route-system-picker"
        routePicker.translatesAutoresizingMaskIntoConstraints = false
        let routeContainer = UIView(); routeContainer.addSubview(routePicker)
        NSLayoutConstraint.activate([
            routePicker.centerXAnchor.constraint(equalTo: routeContainer.centerXAnchor),
            routePicker.topAnchor.constraint(equalTo: routeContainer.topAnchor),
            routePicker.bottomAnchor.constraint(equalTo: routeContainer.bottomAnchor),
            routePicker.widthAnchor.constraint(equalToConstant: 64), routePicker.heightAnchor.constraint(equalToConstant: 64),
        ])
        let stack = UIStackView(arrangedSubviews: [header, routeLabel, hint, routeContainer])
        stack.axis = .vertical; stack.spacing = 20; stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll); scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -20),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),
        ])
        updateRoute()
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        updateRoute()
        if routeObserver == nil {
            routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification,
                object: nil, queue: .main) { [weak self] _ in
                    MainActor.assumeIsolated { self?.updateRoute() }
                }
        }
    }
    private func updateRoute() {
        let name = AVAudioSession.sharedInstance().currentRoute.outputs.map(\.portName).joined(separator: " / ")
        routeLabel.text = name.isEmpty ? labels["fallback"] : name
    }
    @objc func closeSheet() { dismiss(animated: true) { [weak self] in self?.finish() } }
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || presentingViewController == nil { finish() }
    }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish() }
    private func finish() {
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver); self.routeObserver = nil }
        let callback = completion; completion = nil; callback?()
    }
    deinit { if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) } }
}

extension FoliaNativePlugin {
    @objc func chooseAudioRoute(_ call: CAPPluginCall) { run(call) {
        guard let host = self.bridge?.viewController, let labels = call.getObject("labels") as? [String: String],
              let light = call.getBool("light") else { throw MobileFailure("invalid-audio-route-labels") }
        try NativeAudioRoutePicker.present(on: host, labels: labels, light: light) { call.resolve() }
    } }
}
