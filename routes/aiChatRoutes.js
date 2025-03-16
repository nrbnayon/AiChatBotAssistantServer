import express from "express";
import Groq from "groq-sdk";
import auth from "../middleware/authMiddleware.js";
import { createEmailService } from "../services/emailService.js";
import { catchAsync } from "../utils/errorHandler.js";

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const systemMessage = `
You are Grok, an AI email assistant and administrator with agentic capabilities. Your role is to:
1. Analyze email content and context.
2. Respond to user queries about emails.
3. Perform email actions based on user prompts (e.g., send, reply, filter, archive).
4. Automate tasks like drafting and sending emails on behalf of the user.

## Guidelines:
- Use only the provided email context.
- Be precise, accurate, and concise.
- If information is missing, say: "I cannot find this information in the provided emails."
- For actions like sending emails, craft complete messages with subject, body, and appropriate tone.
- Use markdown for clear formatting.
- Support agentic features, e.g., "tell X to send me a draft" should result in sending an email to X.

## Available Actions:
- send, reply, forward, markAsRead, markAsUnread, archive, trash, untrash, delete, listEmails, getImportantEmails
`;

router.post(
  "/",
  auth(),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { prompt, maxResults = 50 } = req.body;

    if (!prompt) {
      return res
        .status(400)
        .json({ success: false, message: "Prompt is required" });
    }

    const emails = (await emailService.fetchEmails({ maxResults })).messages;
    const emailContext = emails.map((e) => ({
      id: e.id,
      subject: e.subject,
      from: e.from,
      to: e.to,
      snippet: e.snippet,
      body: e.body,
    }));

    const fullPrompt = `
${systemMessage}

## Email Context:
${JSON.stringify(emailContext, null, 2)}

## User Prompt:
${prompt}

Analyze the email context and respond to the prompt. If the prompt requires an action (e.g., sending an email), return a JSON object with:
- "action": the action to perform
- "params": parameters for the action (e.g., { to, subject, body })
- "message": a user-friendly response
If no action is required, return a plain text response in markdown.
`;

    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: fullPrompt }],
      model: "llama3-70b-8192",
      temperature: 0.7,
      max_tokens: 2048,
    });

    const content =
      response.choices[0]?.message?.content || "No response generated";
    let result;

    try {
      const jsonResponse = JSON.parse(content);
      if (jsonResponse.action) {
        const actionResult = await emailService.executeEmailAction(
          jsonResponse
        );
        result = {
          success: true,
          message: actionResult.message,
          data: actionResult.result,
        };
      } else {
        result = { success: true, message: content };
      }
    } catch (e) {
      // If not JSON, treat as plain markdown response
      result = { success: true, message: content };
    }

    res.json(result);
  })
);

export default router;
