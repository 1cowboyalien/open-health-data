// html2pdf.swift: render an HTML file with WebKit (Safari's engine) into a paginated US Letter PDF.
// No extra installs. Usage: swift notes/html2pdf.swift in.html out.pdf
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: swift html2pdf.swift in.html out.pdf"); exit(1) }
let inURL = URL(fileURLWithPath: args[1]).absoluteURL
let outURL = URL(fileURLWithPath: args[2]).absoluteURL

class Renderer: NSObject, WKNavigationDelegate {
    let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 816, height: 1056))
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 816, height: 1056), styleMask: [.borderless], backing: .buffered, defer: false)
    func start() {
        window.contentView = web
        web.navigationDelegate = self
        web.loadFileURL(inURL, allowingReadAccessTo: inURL.deletingLastPathComponent())
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.printIt() }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { print("load failed: \(error)"); exit(1) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { print("load failed: \(error)"); exit(1) }
    func printIt() {
        let info = NSPrintInfo()
        info.paperSize = NSSize(width: 612, height: 792)
        info.topMargin = 40; info.bottomMargin = 40; info.leftMargin = 40; info.rightMargin = 40
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isVerticallyCentered = false
        info.isHorizontallyCentered = false
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = outURL
        let op = web.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        op.view?.frame = web.bounds
        op.runModal(for: window, delegate: self, didRun: #selector(done(_:success:contextInfo:)), contextInfo: nil)
    }
    @objc func done(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        print(success ? "wrote \(outURL.path)" : "print failed"); exit(success ? 0 : 1)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let r = Renderer()
r.start()
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { print("timed out"); exit(1) }
app.run()
