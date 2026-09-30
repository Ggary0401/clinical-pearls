// 產生預設分享圖 assets/og-default.jpg（1200x630）。只在需要重畫時手動執行：
//   swift scripts/make-og-default.swift
// 這是一次性工具，不屬於 build 流程（build 維持零依賴、只用 node）。
import AppKit

let W = 1200, H = 630
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: W, height: H)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

let bg = NSGradient(starting: NSColor(red: 0.07, green: 0.24, blue: 0.27, alpha: 1),
                    ending: NSColor(red: 0.03, green: 0.11, blue: 0.14, alpha: 1))!
bg.draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -35)

func text(_ s: String, _ font: NSFont, _ color: NSColor, y: CGFloat, kern: CGFloat = 0) {
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .kern: kern]
    let a = NSAttributedString(string: s, attributes: attrs)
    a.draw(at: NSPoint(x: 96, y: y))
}
let white = NSColor.white
let soft = NSColor(white: 1, alpha: 0.78)
NSColor(red: 0.55, green: 0.85, blue: 0.80, alpha: 1).setFill()
NSRect(x: 96, y: 520, width: 72, height: 4).fill()
text("Kylin's Note", NSFont(name: "HelveticaNeue-Light", size: 110) ?? .systemFont(ofSize: 110), white, y: 380)
text("林耿億醫師的醫療筆記", NSFont(name: "PingFangTC-Regular", size: 56) ?? .systemFont(ofSize: 56), soft, y: 292)
text("痔瘡 · 腸胃鏡 · 腸道健康", NSFont(name: "PingFangTC-Light", size: 34) ?? .systemFont(ofSize: 34), soft, y: 210)
text("drgarylin.com", NSFont(name: "HelveticaNeue", size: 30) ?? .systemFont(ofSize: 30),
     NSColor(red: 0.55, green: 0.85, blue: 0.80, alpha: 1), y: 80, kern: 2)

NSGraphicsContext.restoreGraphicsState()
let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.88])!
try! data.write(to: URL(fileURLWithPath: "assets/og-default.jpg"))
