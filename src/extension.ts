import * as vscode from "vscode";
import axios from "axios";

/* --------------------------------------------------------------
   Constants and Secure API-key storage (Gemini)
   -------------------------------------------------------------- */
const KEY_NAME = "geminiApiKey";
const GEMINI_MODEL = "gemini-2.5-flash";
const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

async function getKey(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  return await ctx.secrets.get(KEY_NAME);
}
async function setKey(ctx: vscode.ExtensionContext, key: string): Promise<void> {
  await ctx.secrets.store(KEY_NAME, key.trim());
}

/* --------------------------------------------------------------
   Helper: Function/Class Discovery
   -------------------------------------------------------------- */

// Finds the starting line index and text of functions/classes in the document
function findDeclarations(document: vscode.TextDocument): { line: number; text: string }[] {
  const declarations: { line: number; text: string }[] = [];

  for (let i = 0; i < document.lineCount; i++) {
    const lineText = document.lineAt(i).text.trim();

    // Regex to find function, const function, or class declarations
    const regex = /^(export\s+)?(async\s+)?(function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(|class\s+\w+)/;

    // Only find a declaration if it is NOT preceded by an existing doc block
    if (regex.test(lineText)) {
      const prevLine = i > 0 ? document.lineAt(i - 1).text.trim() : '';
      // Check for existing JSDoc end ('*/') or Python Docstring end ('"""')
      if (prevLine !== '*/' && prevLine !== '"""') {
        declarations.push({
          line: i,
          text: document.lineAt(i).text,
        });
      }
    }
  }
  return declarations;
}

/**
 * Ensures the documentation block only contains valid JSDoc/Docstring content
 * and manually closes the block if it was truncated by the LLM.
 * @param rawOutput The raw text received from the Gemini API.
 * @returns Cleaned documentation string or empty string.
 */
function cleanAndCloseDoc(rawOutput: string): string {
  const lines = rawOutput.split('\n');
  const cleanLines: string[] = [];
  let inDocBlock = false;
  let foundDocStart = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for JSDoc or Docstring start
    if (trimmed.startsWith('/**') || trimmed.startsWith('"""')) {
      inDocBlock = true;
      foundDocStart = true;
    }

    if (inDocBlock) {
      cleanLines.push(line);
    }

    // Check for JSDoc or Docstring end
    if (inDocBlock && (trimmed.endsWith('*/') || trimmed.endsWith('"""'))) {
      inDocBlock = false;
      break; // Stop processing after the first closing tag is found
    }

    // Aggressively remove unique markers if present 
    if (trimmed.includes('[START_DOC]')) {
      // If the marker is on a line that was added, remove it.
      if (cleanLines.length > 0 && cleanLines[cleanLines.length - 1].includes('[START_DOC]')) {
        cleanLines.pop();
      }
      inDocBlock = true; // Restart block tracking
      continue;
    }
  }

  let finalDoc = cleanLines.join('\n').trim();

  // Aggressive final clean-up to remove unique markers
  finalDoc = finalDoc.replace(/\[START_DOC\]/g, '').replace(/\[END_DOC\]/g, '').trim();

  // Manual Truncation Fix: Ensure the block is closed if it started but didn't end
  if (foundDocStart && !finalDoc.endsWith('*/') && !finalDoc.endsWith('"""') && finalDoc.length > 0) {
    // Find the correct indentation for the closing tag (assumes one space/star per line)
    const lastLine = finalDoc.split('\n').pop()?.trim();
    const indent = lastLine?.match(/^(\s*\*)/)?.[1] || ' *';
    finalDoc += `\n${indent}/`; // Add the closing tag on a new line
  }

  // Final markdown cleanup
  finalDoc = finalDoc.replace(/^```[a-z]*\s*\n|\n```\s*$/gi, '').trim();

  return finalDoc.trim();
}


/* --------------------------------------------------------------
   Activation and Command Registration
   -------------------------------------------------------------- */
export function activate(context: vscode.ExtensionContext) {
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  status.text = "$(comment-discussion) Gen Docs";
  status.command = "codeCommentGenerator.generateComments";
  status.tooltip = "Generate JSDoc/Docstring for declarations";
  status.show();
  context.subscriptions.push(status);

  /* ---- Set Gemini API key ---- */
  context.subscriptions.push(
    vscode.commands.registerCommand("codeCommentGenerator.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your Gemini API key",
        password: true,
        placeHolder: "AIza...",
        ignoreFocusOut: true,
      });
      if (!key) {
        vscode.window.showWarningMessage("Cancelled – no key saved.");
        return;
      }
      await setKey(context, key);
      vscode.window.showInformationMessage("Gemini API key saved securely.");
    })
  );

  /* ---- Generate Function/Class Docs (Process One-by-One) ---- */
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codeCommentGenerator.generateComments",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("Open a file first.");
          return;
        }

        const declarations = findDeclarations(editor.document);

        if (declarations.length === 0) {
          vscode.window.showWarningMessage("No undocumented functions or classes found.");
          return;
        }

        const apiKey = await getKey(context);
        if (!apiKey) {
          vscode.window.showErrorMessage(
            "Gemini API key missing. Run **CodeCommentGenerator: Set Gemini API Key** first."
          );
          return;
        }

        const docsToInsert: { line: number; text: string }[] = [];

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Generating detailed documentation…",
            cancellable: true,
          },
          async (progress) => {

            const systemInstruction =
              "You are an expert software engineer specializing in detailed documentation. " +
              "For the following function or class declaration, return **only** the complete documentation block (JSDoc/Docstring). " +
              "The description must be detailed, comprehensive, and elaborate, explaining the core logic and algorithm. " +
              "Your output must strictly start with **[START_DOC]** on its own line and end with **[END_DOC]** on its own line. " +
              "Do NOT include the original code, surrounding markdown fences, or the start/end markers inside the JSDoc/Docstring content itself. " +
              "Use JSDoc style.";

            let completedDocs = 0;

            // Process each declaration individually
            for (const decl of declarations) {

              progress.report({
                increment: (100 / declarations.length) / 2,
                message: `Processing line ${decl.line + 1}: ${decl.text.trim()}...`
              });

              try {
                const resp = await axios.post(
                  `${API_BASE_URL}${GEMINI_MODEL}:generateContent?key=${apiKey}`,
                  {
                    generationConfig: {
                      temperature: 0.1,
                      maxOutputTokens: 2048,
                    },
                    contents: [
                      {
                        role: "user",
                        parts: [{ text: systemInstruction }]
                      },
                      {
                        role: "user",
                        parts: [{ text: decl.text }]
                      }
                    ],
                  },
                  {
                    headers: { "Content-Type": "application/json" },
                    timeout: 45_000,
                  }
                );

                const rawOutput = resp.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

                // Clean and finalize the documentation block using helper function
                const docText = cleanAndCloseDoc(rawOutput);

                if (docText) {
                  docsToInsert.push({ line: decl.line, text: docText });
                } else {
                  console.warn(`Skipped documentation for line ${decl.line + 1}: Empty response after cleaning.`);
                }

              } catch (err: any) {
                const msg = err.response?.data?.error?.message || err.message || "Network error";
                vscode.window.showErrorMessage(`Gemini API error on line ${decl.line + 1}: ${msg}`);
              }

              completedDocs++;
            } // End of declaration loop

            // --- FINAL Insertion Logic ---
            progress.report({ increment: 50, message: "Applying documentation to file..." });

            const success = await editor.edit((edit) => {
              // Insert in REVERSE order to maintain accurate line positions
              for (let i = docsToInsert.length - 1; i >= 0; i--) {
                const { line, text } = docsToInsert[i];

                try {
                  const lineObject = editor.document.lineAt(line);
                  const indentation = lineObject.text.substring(0, lineObject.firstNonWhitespaceCharacterIndex);

                  // Re-indent the entire block using the function's indentation and ensure a final newline
                  const reIndentedDoc = text.split('\n')
                    .map(docLine => {
                      // Only apply indentation to non-empty lines
                      return docLine.trim().length > 0 ? indentation + docLine : '';
                    })
                    .join('\n') + '\n';

                  const pos = new vscode.Position(line, 0);
                  edit.insert(pos, reIndentedDoc);

                } catch (e) {
                  console.error(`Failed to insert doc at line ${line}:`, e);
                }
              }
            });

            if (!success) {
              vscode.window.showErrorMessage("Failed to apply all documentation edits to the file.");
              return;
            }

            // --- MANUAL SAVE ATTEMPT (NON-AUTOMATIC) ---
            const saveSuccess = await editor.document.save();
            if (saveSuccess) {
              vscode.window.showInformationMessage(`Documentation added for ${completedDocs} declarations and file saved!`);
            } else {
              vscode.window.showInformationMessage(`Documentation added for ${completedDocs} declarations. Please save manually.`);
            }
          }
        );
      }
    )
  );

  // Register a simple welcome view (shows when user clicks your Activity Bar icon)
  const provider = vscode.window.registerWebviewViewProvider(
    'code-comment-welcome',
    {
      resolveWebviewView: (webviewView) => {
        webviewView.webview.options = { enableScripts: false };
        webviewView.webview.html = `
          <!DOCTYPE html>
          <html>
          <head><meta charset="UTF-8"></head>
          <body style="padding: 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground);">
            <h2>AI Comment Generator</h2>
            <p>Click the <strong>Gen Docs</strong> button in the status bar (bottom-right) or run command:</p>
            <p><code>CodeCommentGenerator: Generate AI Comments</code></p>
            <p>Make sure you have set your Gemini API key first.</p>
            <p>More features coming soon!</p>
          </body>
          </html>`;
      }
    }
  );

  context.subscriptions.push(provider);
}

export function deactivate() { }