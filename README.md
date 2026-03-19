# Code-Comment-Generator
Code Comment Generator AI-Powered Code Documentation Automatically generates detailed JSDoc-style comments for functions, classes, and arrow functions using Google's Gemini AI. Free to use with your own Gemini API key. Supports JavaScript, TypeScript, and more.

Features

One-Click Generation: Click the status bar "Gen Docs" button or run the command to scan your file and add comprehensive comments above undocumented declarations. Smart Detection: Identifies functions (function foo()), arrow functions (const foo = () =>), and classes (class Foo {}) without existing docs. Detailed & Structured Output: Gemini creates elaborate explanations including purpose, parameters (@param), returns (@returns), edge cases, and algorithms — all in proper JSDoc format. Indentation-Aware: Matches your code's indentation for seamless integration. Secure API Key Storage: Your Gemini key is stored encrypted in VS Code's secrets (never logged or exposed). Progress Feedback: Real-time notifications show processing status for each declaration. Batch Processing: Handles multiple functions in one go, with gentle rate limiting for free-tier users.

Requirements

Gemini API Key (free tier sufficient): Get one at Google AI Studio. Set it via command: Ctrl+Shift+P → "CodeCommentGenerator: Set Gemini API Key". No credit card needed; ~15–60 requests/minute limit.

VS Code 1.93.0+ (specified in package.json).

No other dependencies — works out-of-the-box. Extension Settings This extension contributes the following settings:

codeCommentGenerator.commentMode: Choose comment placement. "inline": Adds comments at the end of lines (default). "above": Adds full JSDoc blocks above declarations.

Access via: Ctrl+, → Search "Code Comment Generator". Known Issues

Truncated Outputs: Rare Gemini API truncations may occur on very complex functions; retry or increase maxOutputTokens in code if needed. Language Support: Optimized for JS/TS; may need regex tweaks for Python docstrings or other langs. Rate Limits: Free Gemini tier may throttle on large files (>10 functions) — process in batches. Arrow Functions: Detects most, but deeply nested ones might be missed.

Report issues on GitHub (create a repo for better tracking). Release Notes 0.0.2

Improved prompt for better JSDoc adherence (no more code fences or extra text). Switched to gemini-1.5-flash for faster, reliable free-tier performance. Added arrow function detection and rate limiting. Enhanced cleaning logic to force-close truncated blocks.

0.0.1

Initial release with basic function/class detection and Gemini integration.

Following Extension Guidelines This extension follows VS Code best practices: secure key storage, no telemetry, minimal permissions.

Extension Guidelines

To package successfully now, replace your README.md with the above content (save it), then re-run vsce package. The template text (like "Enjoy!" and Markdown shortcuts) was blocking it — VSCE checks for that to ensure a polished README.
