// routes/aiModelRoutes.js
import express from "express";
import { ApiError, catchAsync, logErrorWithStyle } from "../utils/errorHandler";

// Models configuration
const availableModels = [
  {
    id: "mixtral-8x7b-32768",
    name: "Mixtral-8x7b-32768",
    developer: "Mistral",
    contextWindow: 32768,
    description:
      "Powerful open-source mixture-of-experts model with exceptional reasoning capabilities",
  },
  {
    id: "llama-3-70b",
    name: "Llama 3 70B",
    developer: "Meta",
    contextWindow: 128000,
    maxCompletionTokens: 32768,
    description:
      "Meta's largest open LLM offering best-in-class performance and reasoning",
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    developer: "Meta",
    contextWindow: 128000,
    maxCompletionTokens: 8192,
    description: "Efficient and responsive model for quick interactions",
  },
  {
    id: "gemma-7b",
    name: "Gemma 7B",
    developer: "Google",
    contextWindow: 8192,
    description: "Google's lightweight yet powerful open model",
  },
  {
    id: "gemma2-9b-it",
    name: "Gemma 2 9B IT",
    developer: "Google",
    contextWindow: 8192,
    description: "Instruction-tuned version of Google's Gemma 2 9B model",
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile",
    developer: "Meta",
    contextWindow: 128000,
    maxCompletionTokens: 32768,
    description:
      "Meta's advanced 70B parameter model with versatile capabilities",
    isDefault: true,
  },
  {
    id: "llama-guard-3-8b",
    name: "Llama Guard 3 8B",
    developer: "Meta",
    contextWindow: 8192,
    description: "Specialized safety model from Meta's Llama 3 family",
  },
  {
    id: "llama3-70b-8192",
    name: "Llama 3 70B (8K)",
    developer: "Meta",
    contextWindow: 8192,
    description: "Meta's 70B parameter model with 8K context window",
  },
  {
    id: "llama3-8b-8192",
    name: "Llama 3 8B (8K)",
    developer: "Meta",
    contextWindow: 8192,
    description: "Meta's efficient 8B parameter model with 8K context window",
  },
];

// Helper functions
export const getDefaultModel = () => {
  const defaultModel = availableModels.find((model) => model.isDefault);
  return defaultModel || availableModels[0];
};

export const getModelById = (id) => {
  return availableModels.find((model) => model.id === id);
};

class ModelProvider {
  constructor() {
    this.retryCount = 3;
    this.retryDelay = 1000; 
  }

  async callWithFallbackChain(modelId, requestData, fallbackChain = []) {
    const completeChain = [modelId, ...fallbackChain];
    let lastError = null;

    console.log(`Starting model call with fallback chain: [${completeChain.join(', ')}]`);

    for (const currentModelId of completeChain) {
      try {
        const model = getModelById(currentModelId);
        if (!model) {
          console.warn(
            `Model ${currentModelId} not found in available models, skipping`
          );
          continue;
        }

        console.log(`Attempting to use model: ${model.name}`);
        const result = await this.callModelWithRetry(model, requestData);

        console.log(`Successfully used model: ${model.name}`);
        return {
          result,
          modelUsed: model,
          fallbackUsed: currentModelId !== modelId,
        };
      } catch (error) {
        lastError = error;
        logErrorWithStyle(error);
        console.warn(
          `Model ${currentModelId} failed, trying next in fallback chain`
        );
      }
    }

    throw new ApiError(
      503,
      `All models in the fallback chain failed: ${lastError?.message || 'Unknown error'}`
    );
  }

  async callModelWithRetry(model, requestData) {
    let attemptCount = 0;
    let lastError = null;
    let currentRetryDelay = this.retryDelay;

    while (attemptCount < this.retryCount) {
      try {
        const result = await this.simulateModelCall(model, requestData);
        return result;
      } catch (error) {
        lastError = error;
        attemptCount++;

        if (attemptCount < this.retryCount) {
          console.warn(
            `Attempt ${attemptCount} failed for model ${model.id}, retrying after ${currentRetryDelay}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, currentRetryDelay));
          currentRetryDelay *= 2;
        }
      }
    }

    throw new ApiError(
      503,
      `Model ${model.id} failed after ${this.retryCount} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  async simulateModelCall(model, requestData) {

    const randomFailure = Math.random() < 0.3; // 30% chance of failure

    if (randomFailure) {
      throw new ApiError(503, `Model ${model.id} temporarily unavailable`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      model: model.id,
      completion: `This is a simulated response from ${model.name}`,
      processingTime: Math.floor(Math.random() * 1000) + 500,
      tokenCount: Math.floor(Math.random() * 100) + 50,
    };
  }
}

const modelProvider = new ModelProvider();

const router = express.Router();

router.get("/", (req, res) => {
  res.json(availableModels);
});

router.get("/default", (req, res) => {
  const defaultModel = getDefaultModel();
  res.json(defaultModel);
});

router.get(
  "/:id",
  catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const model = getModelById(id);

    if (model) {
      res.json(model);
    } else {
      throw new ApiError(404, `Model with ID ${id} not found`);
    }
  })
);

router.post(
  "/generate",
  catchAsync(async (req, res, next) => {
    const { modelId, prompt, fallbackChain = [] } = req.body;

    if (!modelId) {
      throw new ApiError(400, "Model ID is required");
    }

    if (!prompt) {
      throw new ApiError(400, "Prompt is required");
    }
    if (!Array.isArray(fallbackChain)) {
      throw new ApiError(400, "Fallback chain must be an array");
    }
    const primaryModel = getModelById(modelId);
    if (!primaryModel) {
      throw new ApiError(404, `Primary model with ID ${modelId} not found`);
    }
    const validFallbackChain = fallbackChain.filter((id) => {
      const model = getModelById(id);
      if (!model) {
        console.warn(
          `Fallback model with ID ${id} not found, removing from chain`
        );
        return false;
      }
      return true;
    });

    try {
      const result = await modelProvider.callWithFallbackChain(
        modelId,
        { prompt },
        validFallbackChain
      );

      res.json({
        success: true,
        ...result,
        fallbackChainUsed: validFallbackChain,
      });
    } catch (error) {
      next(error);
    }
  })
);
export default router;