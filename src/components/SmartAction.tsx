import {
  Action,
  ActionPanel,
  Form,
  LocalStorage,
  showToast,
  Toast,
  useNavigation,
  getSelectedText,
  AI,
  Clipboard,
  popToRoot,
  getPreferenceValues,
  closeMainWindow,
  launchCommand,
  LaunchType,
} from "@raycast/api";
import { useState, useEffect } from "react";

interface ActionConfig {
  title: string;
  prompt: string;
}

const DEFAULT_CONFIGS: Record<string, ActionConfig> = {
  "action-1": {
    title: "Fix Grammar",
    prompt:
      "Fix all typos, spelling errors, and grammar issues in the following text. Return only the corrected text without any explanation:",
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

interface LaunchContext {
  forceEditor?: boolean;
}

export function SmartAction({
  actionId,
  launchContext,
}: {
  actionId: string;
  launchContext?: LaunchContext;
}) {
  const { pop } = useNavigation();
  const [config, setConfig] = useState<ActionConfig | null>(null);
  const [showEditor, setShowEditor] = useState(
    launchContext?.forceEditor || false,
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      // 1. Get preferences (fallback)
      const prefs = getPreferenceValues();

      // 2. Get LocalStorage (override)
      let currentConfig: ActionConfig = {
        title:
          (prefs.title as string) ||
          DEFAULT_CONFIGS[actionId]?.title ||
          actionId,
        prompt:
          (prefs.prompt as string) || DEFAULT_CONFIGS[actionId]?.prompt || "",
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

      setConfig(currentConfig);

      // 3. If we are forced into editor mode, stop here
      if (launchContext?.forceEditor) {
        setShowEditor(true);
        setIsLoading(false);
        return;
      }

      // 4. Check for selected text
      try {
        const selectedText = await getSelectedText();
        if (selectedText && selectedText.trim().length > 0) {
          // Hide Raycast window
          await closeMainWindow();
          // Run AI immediately
          await runAI(currentConfig.title, currentConfig.prompt, selectedText);
          return;
        }
      } catch (error) {
        // No selection
        await closeMainWindow();
        const toast = await showToast({
          style: Toast.Style.Failure,
          title: "No text selected",
          message: "Select text OR use cmd+shift+e to edit prompt.",
        });

        toast.primaryAction = {
          title: "Edit Prompt",
          shortcut: { modifiers: ["cmd", "shift"], key: "e" },
          onAction: () => {
            launchCommand({
              name: actionId,
              type: LaunchType.UserInitiated,
              context: { forceEditor: true },
            });
          },
        };

        popToRoot();
        return;
      }

      // If we got here, it means selection failed or was empty
      setShowEditor(true);
      setIsLoading(false);
    }

    init();
  }, [actionId]);

  async function runAI(
    title: string,
    promptTemplate: string,
    selectedText: string,
  ) {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `${title}...`,
    });

    // Add Edit shortcut to toast
    toast.primaryAction = {
      title: "Edit Prompt",
      shortcut: { modifiers: ["cmd", "shift"], key: "e" },
      onAction: () => {
        launchCommand({
          name: actionId,
          type: LaunchType.UserInitiated,
          context: { forceEditor: true },
        });
      },
    };

    try {
      const prompt = `${promptTemplate}\n\n${selectedText}`;
      const result = await AI.ask(prompt);
      if (!result) throw new Error("AI returned empty response");

      await Clipboard.paste(result);
      toast.style = Toast.Style.Success;
      toast.title = "Done!";
      popToRoot();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed";
      toast.message = String(error);
      // On failure, maybe don't pop to root so they can see the message?
      // Or offer to edit
      toast.primaryAction = {
        title: "Edit Prompt",
        onAction: () => {
          launchCommand({
            name: actionId,
            type: LaunchType.UserInitiated,
            context: { forceEditor: true },
          });
        },
      };
    }
  }

  async function handleSave(values: { title: string; prompt: string }) {
    try {
      const saved = await LocalStorage.getItem<string>("action-configs");
      const configs = saved ? JSON.parse(saved) : {};
      configs[actionId] = values;
      await LocalStorage.setItem("action-configs", JSON.stringify(configs));
      await showToast({
        style: Toast.Style.Success,
        title: "Configuration saved!",
      });
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to save",
        message: String(error),
      });
    }
  }

  if (isLoading && !showEditor) {
    return <Form isLoading={true} />;
  }

  if (showEditor && config) {
    return (
      <Form
        actions={
          <ActionPanel>
            <Action.SubmitForm title="Save and Close" onSubmit={handleSave} />
            <Action
              title="Run Now (need Selection)"
              onAction={async () => {
                try {
                  const text = await getSelectedText();
                  await closeMainWindow();
                  runAI(config.title, config.prompt, text);
                } catch (e) {
                  showToast({
                    style: Toast.Style.Failure,
                    title: "No text selected",
                  });
                }
              }}
            />
          </ActionPanel>
        }
      >
        <Form.Description
          title={`Editing ${config.title}`}
          text="Modify the prompt and title. Multiline is supported here."
        />
        <Form.TextField id="title" title="Title" defaultValue={config.title} />
        <Form.TextArea
          id="prompt"
          title="Prompt"
          defaultValue={config.prompt}
        />
      </Form>
    );
  }

  return null;
}
