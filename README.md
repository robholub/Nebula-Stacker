## NebulaStacker Pro

NebulaStacker Pro is a high-performance, browser-based astrophotography integration suite designed specifically for deep-space objects. Unlike traditional stacking software that requires heavy desktop installations, NebulaStacker runs entirely in your browser as a Progressive Web App (PWA), utilizing the local CPU/GPU to align and stack images without ever uploading your data to the cloud.

🚀 **Key Features**
 - Triangle-Invariance Alignment Engine: A robust geometric matching algorithm that detects star patterns (asterisms) to handle both translation (shift) and rotation between sub-exposures.
 - 32-bit Deep-Sky Integration: Uses a high-precision floating-point accumulator to preserve maximum dynamic range and significantly boost Signal-to-Noise Ratio (SNR).
 - Mobile-First "Develop" Lab: A professional post-processing interface designed for touch. View real-time changes as you adjust gain, non-linear stretching, and black points.
 - PWA Ready: Install the app on your iOS or Android device for field use. Process your images immediately after a session at the telescope.
 - SCNR & Color Calibration: Built-in tools to remove green noise (sensor artifacting) and neutralize background light pollution.
 - Privacy-First: No servers involved. Your high-resolution files stay on your device.

🛠 **Technical Deep Dive**
 - The Alignment Algorithm
 - The core of the app is a Geometric Invariant Triangle Matcher. For every frame:
 - Centroid Detection: It identifies the brightest 35 stars using a local-maxima search with center-of-mass estimation for sub-pixel accuracy.
 - Triangle Descriptors: It forms triangles from star triples and calculates the ratio of the sides. These ratios are "invariant" to rotation and scale.
 - RANSAC Matching: It matches triangles between the source and reference frames. Only patterns that receive a high "vote" count are used to calculate the final $dx, dy$ transformation.

**Stacking Logic**
Integration is performed by averaging pixels into a Float64Array buffer. This prevents the "clipping" found in 8-bit image formats, allowing you to pull faint nebulosity out of the darkness during the "Develop" phase.

📦 **Installation & Setup**
Ensure you have Node.js installed.

1) Clone the Repo:
```
git clone [https://github.com/yourusername/nebula-stacker-pro.git](https://github.com/yourusername/nebula-stacker-pro.git)
cd nebula-stacker-pro
```

2) Install Dependencies:
```
npm install
```

3) Local Development:
```
npm run dev
```

4) Build for Production:
```
npm run build
```

📱 **Mobile Use (PWA)**
To use NebulaStacker as a native app on your phone:
1) Navigate to your deployed URL (e.g., Vercel or GitHub Pages).
2) iOS: Tap the "Share" icon and select "Add to Home Screen".
3) Android: Tap the three dots and select "Install App".

🧪 **Recommended Workflow**
1) Library: Upload your light frames (tracked exposures of 30s-120s work best).
2) Reference: Select your sharpest frame as the "Master" using the crosshair icon.
3) Integrate: Hit the "Run Integration" button.
4) Develop: Use the "Nebula Stretch" slider to bring out faint details and "Black Level" to darken the sky background.
5) Export: Save your master PNG for final touch-ups in Photoshop or Lightroom.

📄 **License**
This project is licensed under the MIT License - see the LICENSE file for details.

Clear Skies! 🔭✨
