import {
  AI,
  getPreferenceValues,
  launchCommand,
  LaunchType,
  LocalStorage,
  showToast,
  Toast,
} from "@raycast/api";

import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

interface ActionConfig {
  title: string;
  prompt: string;
}

const DEFAULT_CONFIGS: Record<string, ActionConfig> = {
  "action-1": {
    title: "Fix Grammar",
    prompt:
      "Fix all typos, spelling errors, and grammar issues in the following text. IMPORTANT: Do NOT change the capitalization of the first character - if it starts with a lowercase letter, keep it lowercase. Return only the corrected text without any explanation:",
  },
  "action-2": {
    title: "Make Concise",
    prompt:
      "Make the following text more concise while preserving the key meaning. Return only the rewritten text without explanation:",
  },
  "action-3": {
    title: "Create List",
    prompt:
      "Convert the following text into a clean bullet point list. Return only the list without explanation:",
  },
  "action-4": {
    title: "Make Professional",
    prompt:
      "Rewrite the following text to be more professional and polished, suitable for business communication. Return only the rewritten text without explanation:",
  },
  "action-5": {
    title: "Simplify",
    prompt:
      "Simplify the following text to make it easier to understand. Use simpler words and shorter sentences. Return only the simplified text without explanation:",
  },
};

// In-memory lock to prevent concurrent executions
let isRunning = false;
let lastRunTime = 0;

export async function runStealthAction(
  actionId: string,
  forceEditor?: boolean,
) {
  const now = Date.now();
  console.log(`--- Starting runStealthAction: ${actionId} at ${now} ---`);

  // Concurrency lock with time-based debounce
  if (isRunning) {
    console.log("[LOCKED] Action already running. Aborting.");
    return;
  }

  // Debounce: don't run if last run was less than 3 seconds ago
  if (now - lastRunTime < 3000) {
    console.log(
      `[DEBOUNCE] Last run was ${now - lastRunTime}ms ago. Aborting.`,
    );
    return;
  }

  isRunning = true;
  lastRunTime = now;

  try {
    await runStealthActionInternal(actionId, forceEditor);
  } finally {
    isRunning = false;
    console.log(`--- Finished runStealthAction: ${actionId} ---`);
  }
}

async function runStealthActionInternal(
  actionId: string,
  forceEditor?: boolean,
) {
  // 1. Load config
  const prefs = getPreferenceValues();
  let currentConfig: ActionConfig = {
    title:
      (prefs.title as string) || DEFAULT_CONFIGS[actionId]?.title || actionId,
    prompt: (prefs.prompt as string) || DEFAULT_CONFIGS[actionId]?.prompt || "",
  };

  try {
    const saved = await LocalStorage.getItem<string>("action-configs");
    if (saved) {
      const configs = JSON.parse(saved);
      if (configs[actionId]) {
        currentConfig = { ...currentConfig, ...configs[actionId] };
      }
    }
  } catch (e) {
    console.error("Failed to load configs", e);
  }
  console.log(`Config: ${currentConfig.title}`);

  // 2. Get selected text - with detailed logging
  let selectedText = "";
  let hasRealSelection = false;

  // Get frontmost app
  let frontApp = "";
  try {
    frontApp = execSync(
      `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
    )
      .toString()
      .trim();
    console.log(`[DEBUG] Frontmost app: ${frontApp}`);
  } catch (e) {
    console.log("[DEBUG] Could not get frontmost app");
  }

  // Clear clipboard with a marker to detect if copy happens
  const marker = `__NO_SELECTION_${Date.now()}__`;
  try {
    execSync(`printf '%s' "${marker}" | pbcopy`);
    console.log("[DEBUG] Clipboard cleared with marker");
  } catch (e) {
    console.log("[DEBUG] Could not clear clipboard");
  }

  try {
    if (!forceEditor) {
      // First, try to copy current selection using Cmd+C
      console.log("[DEBUG] Sending Cmd+C to copy selection...");
      execSync(
        `osascript -e 'tell application "System Events" to keystroke "c" using command down'`,
      );

      // Wait for clipboard to update
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check what's in clipboard now
      let clipboardAfter = "";
      try {
        clipboardAfter = execSync("pbpaste").toString();
        console.log(
          `[DEBUG] Clipboard after Cmd+C: "${clipboardAfter.substring(0, 50)}" (${clipboardAfter.length} chars)`,
        );

        if (clipboardAfter === marker) {
          console.log(
            "[DEBUG] Clipboard still has marker - NO SELECTION, auto-selecting line...",
          );

          // Auto-select current line: Cmd+Right (end) then Cmd+Shift+Left (select to start)
          execSync(
            `osascript -e 'tell application "System Events"
              key code 124 using command down
              delay 0.05
              key code 123 using {command down, shift down}
              delay 0.05
              keystroke "c" using command down
            end tell'`,
          );

          // Wait for clipboard
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Check clipboard again
          clipboardAfter = execSync("pbpaste").toString();
          console.log(
            `[DEBUG] Clipboard after auto-select: "${clipboardAfter.substring(0, 50)}" (${clipboardAfter.length} chars)`,
          );

          if (clipboardAfter !== marker && clipboardAfter.trim().length > 0) {
            console.log("[DEBUG] Line auto-selected successfully!");
            hasRealSelection = true;
            selectedText = clipboardAfter;
          } else {
            console.log("[DEBUG] Auto-select failed - empty line?");
            hasRealSelection = false;
          }
        } else {
          console.log("[DEBUG] REAL SELECTION detected!");
          hasRealSelection = true;
          selectedText = clipboardAfter;
        }
      } catch (e) {
        console.log("[DEBUG] Could not read clipboard");
      }
    }
  } catch (e) {
    console.log(`[DEBUG] Error: ${e}`);
    hasRealSelection = false;
  }

  if (
    forceEditor ||
    !hasRealSelection ||
    !selectedText ||
    selectedText.trim().length === 0
  ) {
    const toast = await showToast({
      style: Toast.Style.Failure,
      title: "No text selected",
      message: "Please select text first",
    });
    toast.primaryAction = {
      title: "Edit Prompt",
      onAction: () => {
        launchCommand({
          name: "edit-action",
          type: LaunchType.UserInitiated,
          arguments: { actionId },
        });
      },
    };
    return;
  }

  // 3. Show processing toast
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `${currentConfig.title}...`,
  });

  try {
    // 4. Call AI
    const prompt = `${currentConfig.prompt}\n\n${selectedText}`;
    console.log("Calling AI...");
    const result = await AI.ask(prompt);
    console.log(`AI result: "${result?.substring(0, 50)}..."`);

    if (!result) throw new Error("Empty AI response");

    const cleanResult = result.trim();

    // 5. Insert text using AppleScript keystroke (no clipboard)
    toast.title = "Inserting...";
    console.log(`Typing ${cleanResult.length} chars to replace selection`);

    // Write result to temp file (to handle special characters safely)
    const tempFile = join(tmpdir(), `raycast-ai-${Date.now()}.txt`);
    writeFileSync(tempFile, cleanResult, "utf8");

    try {
      // Use clipboard + Cmd+V paste - this is modifier-safe because we explicitly specify the modifier
      // First, copy result to clipboard
      execSync(`cat "${tempFile}" | pbcopy`);

      // Paste using key code 9 (V) with explicit command modifier
      // This won't combine with other held modifiers because we're using key code
      execSync(
        `osascript -e 'tell application "System Events" to key code 9 using command down'`,
        { timeout: 60000 },
      );
      console.log("Text inserted successfully");
    } finally {
      // Clean up temp file
      try {
        unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    toast.style = Toast.Style.Success;
    toast.title = "Done!";
  } catch (error) {
    console.error("Error:", error);
    toast.style = Toast.Style.Failure;
    toast.title = "Failed";
    toast.message = String(error);
  }
}
