import { Action, ActionPanel, Form, LocalStorage, showToast, Toast, useNavigation, open } from "@raycast/api";
import { useEffect, useState } from "react";
import { LLMService, Model } from "./utils/llm-service";

export default function ConfigureModelCommand() {
    const [models, setModels] = useState<Model[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedModel, setSelectedModel] = useState<string>("");
    const [customModel, setCustomModel] = useState<string>("");
    const { pop } = useNavigation();

    const provider = LLMService.config.aiProvider;

    // Fetch models on load
    useEffect(() => {
        fetchData();
    }, [provider]);

    async function fetchData() {
        setIsLoading(true);
        try {
            // 1. Get currently saved model
            const stored = await LLMService.getSelectedModel();

            // Check if stored value is in the fetched list later, or if it's custom. 
            // For now, we set both. If it matches a dropdown item, dropdown selects it.
            setSelectedModel(stored);
            setCustomModel(stored);

            // 2. Fetch fresh list from API
            if (provider !== "raycast") {
                const fetched = await LLMService.fetchModels();
                setModels(fetched);

                // If stored model is NOT in fetched list, it's likely a custom one
                const isKnown = fetched.some(m => m.id === stored);
                if (isKnown) {
                    setCustomModel(""); // It's a standard model, clear custom field to avoid confusion
                }
            }
        } catch (e) {
            showToast({
                style: Toast.Style.Failure,
                title: "Failed to fetch models",
                message: String(e),
            });
        } finally {
            setIsLoading(false);
        }
    }

    async function handleSubmit(values: { modelId: string; customModelId: string }) {
        const key = `selected_model_${provider}`;

        // Priority: Custom Field > Dropdown
        const finalModel = values.customModelId.trim() || values.modelId;

        if (!finalModel) {
            await showToast({ style: Toast.Style.Failure, title: "Error", message: "Please select or type a model" });
            return;
        }

        // Save to LocalStorage
        await LocalStorage.setItem(key, finalModel);

        await showToast({
            style: Toast.Style.Success,
            title: "Model Saved",
            message: `Using ${finalModel} for ${provider}`,
        });
        pop();
    }

    function getProviderUrl() {
        switch (provider) {
            case "openai": return "https://platform.openai.com/docs/models";
            case "anthropic": return "https://docs.anthropic.com/en/docs/models-overview";
            case "gemini": return "https://ai.google.dev/gemini-api/docs/models/gemini";
            case "openrouter": return "https://openrouter.ai/models";
            default: return "https://raycast.com";
        }
    }

    if (provider === "raycast") {
        return (
            <Form>
                <Form.Description text="You are using Raycast AI." />
                <Form.Description text="Model selection is handled by Raycast Settings > AI." />
            </Form>
        );
    }

    return (
        <Form
            isLoading={isLoading}
            actions={
                <ActionPanel>
                    <Action.SubmitForm title="Save Model" onSubmit={handleSubmit} />
                    <Action title="Reload Models" onAction={fetchData} />
                    <Action title="Open Provider Models Page" onAction={() => open(getProviderUrl())} shortcut={{ modifiers: ["cmd"], key: "o" }} />
                </ActionPanel>
            }
        >
            <Form.Description title="Provider" text={provider.toUpperCase()} />

            <Form.Dropdown
                id="modelId"
                title="Select Model"
                value={selectedModel}
                onChange={(newValue) => {
                    setSelectedModel(newValue);
                    setCustomModel(""); // Clear custom if user picks from list
                }}
                storeValue={false}
            >
                {models.map((model) => (
                    <Form.Dropdown.Item
                        key={model.id}
                        value={model.id}
                        title={`${model.name} (${model.id})`}
                        icon={selectedModel === model.id ? { source: "check.png" } : undefined}
                    />
                ))}
                {models.length === 0 && !isLoading && (
                    <Form.Dropdown.Item value="" title="No models found (Check API Key)" />
                )}
            </Form.Dropdown>

            <Form.Separator />

            <Form.TextField
                id="customModelId"
                title="Custom Model ID"
                placeholder="Optional: Override selected model (e.g. gpt-4-turbo)"
                value={customModel}
                onChange={setCustomModel}
                info="Enter a model ID here to use it instead of the dropdown selection."
            />

            <Form.Description text="Click 'Save Model' to apply changes." />
        </Form>
    );
}
