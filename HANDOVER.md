# SkillBank Africa: Project Development Handover

This document outlines the current state, architecture, and technical details of the **SkillBank Africa** web application as of May 2026.

---

## 1. Project Overview
**SkillBank Africa** is a premium digital marketplace providing high-quality courses and eBooks tailored for the African market. The platform focuses on practical skills for the digital economy, featuring a modern, high-conversion UI and seamless mobile-money integrated checkout simulations.

---

## 2. Technology Stack
- **Frontend**: Semantic HTML5, Vanilla CSS3 (Custom Properties/Tokens), ES6+ JavaScript.
- **Design System**: 
  - **Fonts**: `Clash Display` (Headings), `Bricolage Grotesque` (Body).
  - **Styling**: Glassmorphism, CSS Gradients, Background Orb Animations (Fixed).
  - **Animations**: CSS Keyframes (Fade-ins, Orbs, Floating cards, Carousel scroll).
- **Hosting (Dev)**: Served via `npx serve`.
- **Integrations**: Simulated **Lenco by Broadway** payment gateway.

---

## 3. Directory Structure
```text
skillbank-africa/
├── index.html        # Core structure & semantic sections
├── style.css         # Design tokens, layouts, & animations
├── script.js        # UI logic, payment flow, & localStorage logging
└── assets/           # (Planned) Course thumbnails and PDF/ZIP downloads
```

---

## 4. Key Features & Implementation Status

### A. Hero Section & Carousel
- **Status**: ✅ **Implemented**
- **Details**: Features a unique scrolling text carousel of Southern African tech giants (*Takealot, Naspers, MTN, etc.*).
- **Technical Note**: Uses a `mask-image` linear gradient to create a transparent edge fade-out effect. Animation is a seamless CSS loop.

### B. Goal Section (Our Mission)
- **Status**: ✅ **Implemented**
- **Details**: High-impact section with floating 3D-like cards and platform statistics. Uses radial gradients for background depth.

### C. Course Marketplace
- **Status**: ✅ **Implemented**
- **Details**: Grid layout with glassmorphism cards. Each card triggers a unique payment flow based on data attributes (`data-id`, `data-price`, `data-file`).

### D. Secure Checkout Flow (Simulated)
- **Status**: ✅ **Implemented**
- **Details**: 
  - **Step 1**: Payment Method selection (MTN MoMo, Airtel Money, Card).
  - **Step 2**: Dynamic input fields with validation and "shake" animations for errors.
  - **Step 3**: Simulated API processing (2.8s delay) and success state.
- **Data Persistence**: Successful "purchases" are logged to `localStorage` under the key `sb_purchases`.

### E. FAQ Section
- **Status**: ✅ **Implemented**
- **Details**: Interactive accordion-style FAQ.
- **Technical Note**: JS-driven toggle logic with CSS transitions for smooth height expansion.

---

## 5. Technical Implementation Details (For Developers)

### CSS Design Tokens (`:root`)
The UI is driven by a centralized token system:
- `--pink`: Primary action color.
- `--blue`: Secondary/Trust color.
- `--dark-1/2/3`: Layered background depths.
- `--glass`: Core glassmorphism utility.

### Payment Logic (`script.js`)
- `openPayment(btn)`: Scopes the product data from the clicked card and resets modal state.
- `initiatePayment()`: Handles multi-channel validation logic.
- `showDownload()`: Dynamically updates the `<a>` tag with the specific file path from the course data.

---

## 6. Next Steps & Development Roadmap

1. **Production Backend**: 
   - Replace the `setTimeout` in `script.js` with an actual `POST` request to a serverless function (Vercel/Firebase).
   - Integrate the **Lenco API** for real STK push and Card transactions.
2. **Dynamic Course Loading**: Move the static HTML course cards into a JSON configuration or a CMS/Database (Firebase Firestore).
3. **User Dashboard**: Add a "My Courses" page that reads from the `localStorage` (or database) to show purchased items.
4. **Secure File Delivery**: Implement signed URLs or secure redirects to prevent unauthorized downloads.

---

## 7. Current Local Environment
- **URL**: `http://localhost:64012`
- **Working Directory**: `c:\Users\PC\.vscode\CASE PROJECTS\skillbank-africa`
