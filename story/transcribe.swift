// Turn a recording into text on this Mac (Apple speech recognition, on-device only: the audio never leaves the Mac).
// Built into a tiny app (build_transcribe.sh), because macOS only asks for Speech Recognition permission for an app:
//   open -n -W -g -j "Story Transcribe.app" --args <audio file> <result .json>
// Result: JSON {"text": "...", "segments": [{"t": start s, "d": length s, "w": "word"}...]} or {"error": "..."}
// The first run asks for Speech Recognition permission (System Settings > Privacy & Security > Speech Recognition).
import Foundation
import Speech

func out(_ o: [String: Any]) -> Never {
    let d = try! JSONSerialization.data(withJSONObject: o, options: [])
    if CommandLine.arguments.count > 2 { try? d.write(to: URL(fileURLWithPath: CommandLine.arguments[2])) }
    else { FileHandle.standardOutput.write(d); FileHandle.standardOutput.write("\n".data(using: .utf8)!) }
    exit(o["error"] == nil ? 0 : 1)
}
func note(_ m: String) {   // progress notes next to the result (<result>.log), for finding out where it stops
    guard CommandLine.arguments.count > 2 else { return }
    let p = CommandLine.arguments[2] + ".log"
    if let h = FileHandle(forWritingAtPath: p) { h.seekToEndOfFile(); h.write((m + "\n").data(using: .utf8)!); h.closeFile() }
    else { try? (m + "\n").write(toFile: p, atomically: true, encoding: .utf8) }
}
guard CommandLine.arguments.count > 1 else { out(["error": "usage: transcribe <audio file> [result .json]"]) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let sem = DispatchSemaphore(value: 0)
var status = SFSpeechRecognizer.authorizationStatus()
note("permission status \(status.rawValue) (0 not asked, 1 denied, 2 restricted, 3 allowed)")
if status == .notDetermined {
    SFSpeechRecognizer.requestAuthorization { s in status = s; sem.signal() }
    sem.wait()
}
guard status == .authorized else { out(["error": "Speech Recognition permission not given (status \(status.rawValue))"]) }
guard let rec = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), rec.isAvailable else { out(["error": "recognizer not available"]) }
rec.queue = OperationQueue()   // results arrive on this queue, not the main thread (which is waiting below)
let req = SFSpeechURLRecognitionRequest(url: url)
if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true } else { out(["error": "on-device recognition not available"]) }
req.shouldReportPartialResults = false
note("on-device: \(rec.supportsOnDeviceRecognition); starting")
req.addsPunctuation = true
var result: [String: Any] = ["error": "no result"]
rec.recognitionTask(with: req) { r, e in
    note("callback: result \(r != nil) final \(r?.isFinal ?? false) error \(e.map { "\($0)" } ?? "none")")
    if let r = r, r.isFinal {
        let segs = r.bestTranscription.segments.map { ["t": $0.timestamp, "d": $0.duration, "w": $0.substring] as [String: Any] }
        result = ["text": r.bestTranscription.formattedString, "segments": segs]
        sem.signal()
    } else if let e = e {
        let ns = e as NSError
        // 1110 = no speech found: an empty take, not a failure
        result = ns.code == 1110 ? ["text": "", "segments": []] : ["error": e.localizedDescription]
        sem.signal()
    }
}
if sem.wait(timeout: .now() + 600) == .timedOut { out(["error": "timed out"]) }
out(result)
