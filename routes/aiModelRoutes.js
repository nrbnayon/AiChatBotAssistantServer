// routes/aiModelRoutes.js
import express from "express";
import {
  ApiError,
  catchAsync,
  logErrorWithStyle,
} from "../utils/errorHandler.js";
import AiModel from "../models/AiModel.js";
// Models configuration
const availableModels = [
  {
    id: "gpt-4o-mini", 
    name: "GPT-4.o Mini", 
    developer: "OpenAI",
    provider: "openai",
    contextWindow: 100000000,
    maxCompletionTokens: 10000000000,
    description: "OpenAI's efficient and versatile chat model",
    isDefault: true,
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B Instant",
    developer: "Meta",
    provider: "groq",
    contextWindow: 128000,
    maxCompletionTokens: 8192,
    description: "Efficient and responsive model for quick interactions",
  },
  {
    id: "gemma2-9b-it",
    name: "Gemma 2 9B IT",
    developer: "Google",
    provider: "groq",
    contextWindow: 8192,
    description: "Instruction-tuned version of Google's Gemma 2 9B model",
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B Versatile",
    developer: "Meta",
    provider: "groq",
    contextWindow: 128000,
    maxCompletionTokens: 32768,
    description:
      "Meta's advanced 70B parameter model with versatile capabilities",
  },
  {
    id: "llama3-70b-8192",
    name: "Llama 3 70B (8K)",
    developer: "Meta",
    provider: "groq",
    contextWindow: 8192,
    description: "Meta's 70B parameter model with 8K context window",
  },
  {
    id: "llama3-8b-8192",
    name: "Llama 3 8B (8K)",
    developer: "Meta",
    provider: "groq",
    contextWindow: 8192,
    description: "Meta's efficient 8B parameter model with 8K context window",
  },
];

// Helper functions
export const getDefaultModel = async () => {
  // Check client-side availability of models
  const clientDefaultModel = availableModels.find((model) => model.isDefault);
  if (clientDefaultModel) {
    return clientDefaultModel;
  }

  // If no default found client-side, query database
  try {
    const defaultModel = await AiModel.findOne({ isDefault: true });
    if (defaultModel) {
      return defaultModel;
    }

    // If no default model found, return first available model
    const firstModel = await AiModel.findOne();
    if (!firstModel) {
      throw new ApiError(404, "No AI models found in the database");
    }
    return firstModel;
  } catch (error) {
    throw new ApiError(500, "Error retrieving default model");
  }

  
};

export const getModelById = async (id) => {
  // First, check client-side available models
  const clientModel = availableModels.find((model) => model.id === id);
  if (clientModel) {
    return clientModel;
  }

  // If not found client-side, query the database
  try {
    const databaseModel = await AiModel.findOne({ modelId: id });
    return databaseModel || null;
  } catch (error) {
    console.error(`Error retrieving model with ID ${id}:`, error);
    return null;
  }
};

class ModelProvider {
  constructor() {
    this.retryCount = 3;
    this.retryDelay = 500;
  }

  async callWithFallbackChain(modelId, requestData, fallbackChain = []) {
    const completeChain = [modelId, ...fallbackChain];
    let lastError = null;

    console.log(
      `Starting model call with fallback chain: [${completeChain.join(", ")}]`
    );

    for (const currentModelId of completeChain) {
      try {
        const model = await getModelById(currentModelId);
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
      `All models in the fallback chain failed: ${
        lastError?.message || "Unknown error"
      }`
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
          await new Promise((resolve) =>
            setTimeout(resolve, currentRetryDelay)
          );
          currentRetryDelay *= 2;
        }
      }
    }

    throw new ApiError(
      503,
      `Model ${model.id} failed after ${this.retryCount} attempts: ${
        lastError?.message || "Unknown error"
      }`
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

router.get(
  "/default",
  catchAsync(async (req, res) => {
    const defaultModel = await getDefaultModel();
    res.json(defaultModel);
  })
);

router.get(
  "/:id",
  catchAsync(async (req, res, next) => {
    const { id } = req.params;
    const model = await getModelById(id);

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
    const primaryModel = await getModelById(modelId);
    if (!primaryModel) {
      throw new ApiError(404, `Primary model with ID ${modelId} not found`);
    }
    const validFallbackChain = [];
    for (const id of fallbackChain) {
      const model = await getModelById(id);
      if (model) {
        validFallbackChain.push(id);
      } else {
        console.warn(
          `Fallback model with ID ${id} not found, removing from chain`
        );
      }
    }

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