import AppKit
import ApplicationServices
import ScreenCaptureKit

enum PointerError: Error { case invalid, permission, capture }

func permissions() -> [String: Bool] {
    ["input": AXIsProcessTrusted(), "preview": CGPreflightScreenCaptureAccess()]
}

func pointer() throws -> CGPoint {
    guard let event = CGEvent(source: nil) else { throw PointerError.invalid }
    return event.location
}

func move(_ data: [String: Any]) throws {
    guard let dx = data["dx"] as? Double, let dy = data["dy"] as? Double,
          dx.isFinite, dy.isFinite, abs(dx) <= 500, abs(dy) <= 500 else { throw PointerError.invalid }
    let old = try pointer()
    let desired = CGPoint(x: old.x + dx, y: old.y + dy)
    var displays = [CGDirectDisplayID](repeating: 0, count: 32), count: UInt32 = 0
    guard CGGetActiveDisplayList(32, &displays, &count) == .success, count > 0 else { throw PointerError.invalid }
    // Project onto the nearest real display, including desktops with negative origins and gaps.
    let candidates = displays.prefix(Int(count)).map { id -> CGPoint in
        let bounds = CGDisplayBounds(id)
        return CGPoint(x: min(max(desired.x, bounds.minX), bounds.maxX - 1),
                       y: min(max(desired.y, bounds.minY), bounds.maxY - 1))
    }
    let target = candidates.min { hypot($0.x - desired.x, $0.y - desired.y) < hypot($1.x - desired.x, $1.y - desired.y) }!
    guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: target, mouseButton: .left) else { throw PointerError.invalid }
    event.post(tap: .cghidEventTap)
}

func click(_ data: [String: Any]) throws {
    guard let button = data["button"] as? String, ["left", "right"].contains(button) else { throw PointerError.invalid }
    let point = try pointer(), right = button == "right"
    guard let down = CGEvent(mouseEventSource: nil, mouseType: right ? .rightMouseDown : .leftMouseDown, mouseCursorPosition: point, mouseButton: right ? .right : .left),
          let up = CGEvent(mouseEventSource: nil, mouseType: right ? .rightMouseUp : .leftMouseUp, mouseCursorPosition: point, mouseButton: right ? .right : .left) else { throw PointerError.invalid }
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
}

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
    "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    "Enter": 36, "Tab": 48, "Backspace": 51, "Escape": 53,
    "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126,
]

func keyboard(_ data: [String: Any]) throws {
    guard let key = data["key"] as? String, let code = keyCodes[key],
          let modifiers = data["modifiers"] as? [String], modifiers.count <= 4 else { throw PointerError.invalid }
    let known: [String: CGEventFlags] = ["command": .maskCommand, "control": .maskControl, "option": .maskAlternate, "shift": .maskShift]
    var flags = CGEventFlags()
    for name in modifiers { guard let flag = known[name] else { throw PointerError.invalid }; flags.formUnion(flag) }
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else { throw PointerError.invalid }
    down.flags = flags; up.flags = []
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
}

func typeText(_ data: [String: Any]) throws {
    guard let text = data["text"] as? String, !text.isEmpty, text.count <= 500 else { throw PointerError.invalid }
    let units = Array(text.utf16)
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { throw PointerError.invalid }
    units.withUnsafeBufferPointer { buffer in
        down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
        up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
    }
    down.flags = []; up.flags = []
    down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
}

func input(_ data: [String: Any]) throws {
    guard AXIsProcessTrusted() else { throw PointerError.permission }
    switch data["kind"] as? String {
    case "move": try move(data)
    case "click": try click(data)
    case "key": try keyboard(data)
    case "text": try typeText(data)
    default: throw PointerError.invalid
    }
}

@available(macOS 14.0, *)
func screenFrame() async throws -> Data {
    guard CGPreflightScreenCaptureAccess() else { throw PointerError.permission }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { throw PointerError.capture }
    let configuration = SCStreamConfiguration()
    configuration.width = min(1280, display.width)
    configuration.height = max(1, display.height * configuration.width / max(1, display.width))
    configuration.showsCursor = true
    configuration.capturesAudio = false
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    guard let jpeg = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.65]) else { throw PointerError.capture }
    return jpeg
}

func reply(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) { print(line); fflush(stdout) }
}

@main struct PhonePointerNative {
    static func main() async {
        if CommandLine.arguments.contains("--frame") {
            do {
                guard #available(macOS 14.0, *) else { throw PointerError.capture }
                let jpeg = try await screenFrame()
                FileHandle.standardOutput.write(jpeg)
            } catch { exit(1) }
            return
        }
        // Persistent input process; snapshots run separately and never block this queue.
        while let line = readLine() {
            do {
                guard let bytes = line.data(using: .utf8), let data = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw PointerError.invalid }
                if data["kind"] as? String == "status" { reply(permissions()); continue }
                try input(data); reply(["ok": true])
            } catch PointerError.permission { reply(["error": "Allow Accessibility for the helper in Mac System Settings, then check connection."]) }
            catch { reply(["error": "Mac refused this input."]) }
        }
    }
}
