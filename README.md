# Video Enhancer Pro

A Chromium extension that applies real-time post-processing filters (Sharpening, HDR, Color Grading) to HTML5 videos. 

Built to solve a specific problem: video streams often suffer from low bitrate or poor contrast. This extension injects a highly optimized rendering pipeline directly into the video element to enhance clarity on the fly.

## What's new in v4.0 (Golden Auto)
We completely rewrote the core to handle performance bottlenecks and CORS restrictions on modern SPAs (like YouTube). 

- **Dual-Engine Architecture**: 
  - **WebGL2 GPU Engine**: Runs a 6-stage shader pipeline (Detail Recovery, AMD-style CAS Sharpening, HDR Reinhard) at 60fps on unrestricted domains like Twitch.
  - **CSS Adaptive Engine**: Fallback engine for strict CORS sites (YouTube). Simulates dynamic variance using cheap math (sine/cosine keyed to `video.currentTime`) to avoid heavy pixel reading, bypassing CORS entirely.
- **Hardware Profiles**: 
  - *Desktop*: Uses the discrete GPU and full WebGL/SVG stacks.
  - *Notebook / Mac*: Drops all SVG/WebGL layers and relies purely on native CSS compositing. Zero overhead. Won't wake up your dedicated GPU (RTX/Radeon) or drain the battery on Apple Silicon/Intel laptops.
- **Y2K / Persona 5 UI**: The popup and setup screens were redesigned with a heavy, brutalist P5 aesthetic (custom fonts, skewed containers, cyan accents).

## Installation

You can load this directly into any Chromium browser (Chrome, Edge, Brave, Arc):

1. Download the latest `Golden_Auto_v4.0.zip` from the [Releases](../../releases) tab and extract it.
2. Open your browser and go to `chrome://extensions/`
3. Enable **Developer mode** (top right corner).
4. Click **Load unpacked** and select the extracted folder.
5. Pin the extension to your toolbar.

## Architecture Notes for Devs

If you're reading the source code, here are a few design decisions you might notice:

* **Memory Management**: We use `WeakMap` to bind the rendering engines to `<video>` elements. Since sites like YouTube are SPAs and rarely do hard reloads, this ensures that when a video DOM node is destroyed by the site's router, our engine is automatically garbage collected. No memory leaks.
* **Main Thread Respect**: In earlier versions, scanning for new videos using `querySelectorAll('*')` across thousands of Shadow DOM nodes caused Polymer to crash. We now use a passive `MutationObserver` to cache video elements as they are created, reducing the 60fps `requestAnimationFrame` loop overhead to practically 0ms.
* **CSP Compliance**: Manifest V3 is strict. All inline scripts have been decoupled, and the extension operates without fetching any external remote code.

## Contributing

Feel free to fork and submit PRs. If you want to add new shader algorithms to `webgl.ts`, just make sure they compile efficiently on older IGPs.

## License
MIT
