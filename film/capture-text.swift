// OCR recorded frames for the offline film curation report. No capture or microphone access.
import Foundation
import Vision

let paths = try JSONDecoder().decode([String].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
var rows = [[String: String]]()
for path in paths {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    try VNImageRequestHandler(url: URL(fileURLWithPath: path), options: [:]).perform([request])
    rows.append(["file": path, "text": (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")])
}
try JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
