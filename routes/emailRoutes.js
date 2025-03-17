import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import auth from "../middleware/authMiddleware.js";
import emailAuth from "../middleware/emailMiddleware.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import { createEmailService } from "../services/emailService.js";
import { catchAsync } from "../utils/errorHandler.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

router.get(
  "/",
  auth(),
  emailAuth,
  rateLimitMiddleware(),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { query, maxResults, pageToken, filter } = req.query;
    const result = await emailService.fetchEmails({
      query: query?.toString(),
      maxResults: parseInt(maxResults?.toString() || "100"),
      pageToken: pageToken?.toString(),
      filter: filter?.toString() || "all",
    });
    res.json({
      success: true,
      messages: result.messages,
      nextPageToken: result.nextPageToken,
    });
  })
);

router.get(
  "/:id",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const email = await emailService.getEmail(req.params.id);
    res.json({ success: true, email });
  })
);

router.get(
  "/threads/:id",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const thread = await emailService.getThread(req.params.id);
    res.json({ success: true, thread });
  })
);

router.get(
  "/important",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { query, maxResults, pageToken, keywords, timeRange } = req.query;
    const result = await emailService.fetchEmails({
      query: query?.toString(),
      maxResults: parseInt(maxResults?.toString() || "100"),
      pageToken: pageToken?.toString(),
    });
    const customKeywords = keywords ? keywords.split(",") : undefined;
    const importantEmails = await emailService.filterImportantEmails(
      result.messages,
      customKeywords,
      timeRange?.toString() || "weekly"
    );
    res.json({
      success: true,
      messages: importantEmails,
      nextPageToken: result.nextPageToken,
    });
  })
);

router.post(
  "/send",
  auth(),
  emailAuth,
  upload.array("attachments"),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { to, cc, bcc, subject, body, isHtml } = req.body;
    const files = req.files;
    const attachments = files?.map((file) => ({
      originalname: file.originalname,
      mimetype: file.mimetype,
      content: fs.readFileSync(file.path),
    }));
    const result = await emailService.sendEmail({
      to,
      cc,
      bcc,
      subject,
      body,
      attachments,
      isHtml: isHtml === "true",
    });
    if (files) files.forEach((file) => fs.unlinkSync(file.path));
    res.json({ success: true, message: "Email sent", data: result });
  })
);

router.post(
  "/:id/reply",
  auth(),
  emailAuth,
  upload.array("attachments"),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { body, isHtml } = req.body;
    const files = req.files;
    const attachments = files?.map((file) => ({
      originalname: file.originalname,
      mimetype: file.mimetype,
      content: fs.readFileSync(file.path),
    }));
    const result = await emailService.replyToEmail(req.params.id, {
      body,
      attachments,
      isHtml: isHtml === "true",
    });
    if (files) files.forEach((file) => fs.unlinkSync(file.path));
    res.json({ success: true, message: "Reply sent", data: result });
  })
);

router.post(
  "/:id/forward",
  auth(),
  emailAuth,
  upload.array("attachments"),
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { to, cc, bcc, additionalMessage, isHtml } = req.body;
    const files = req.files;
    const attachments = files?.map((file) => ({
      originalname: file.originalname,
      mimetype: file.mimetype,
      content: fs.readFileSync(file.path),
    }));
    const result = await emailService.forwardEmail(req.params.id, {
      to,
      cc,
      bcc,
      additionalMessage,
      attachments,
      isHtml: isHtml === "true",
    });
    if (files) files.forEach((file) => fs.unlinkSync(file.path));
    res.json({ success: true, message: "Email forwarded", data: result });
  })
);

router.get(
  "/:messageId/attachments/:attachmentId",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { messageId, attachmentId } = req.params;
    const { filename } = req.query;
    const attachment = await emailService.getAttachment(
      messageId,
      attachmentId
    );
    res.setHeader(
      "Content-Type",
      attachment.mimeType || "application/octet-stream"
    );
    if (filename)
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
    res.send(attachment.data);
  })
);

router.post(
  "/:id/markRead",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { read } = req.body;
    await emailService.markAsRead(req.params.id, read !== "false");
    res.json({
      success: true,
      message: `Email marked as ${read !== "false" ? "read" : "unread"}`,
    });
  })
);

router.post(
  "/:id/archive",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    await emailService.archiveEmail(req.params.id);
    res.json({ success: true, message: "Email archived" });
  })
);

router.post(
  "/:id/trash",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    await emailService.trashEmail(req.params.id);
    res.json({ success: true, message: "Email moved to trash" });
  })
);

router.post(
  "/:id/untrash",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    await emailService.untrashEmail(req.params.id);
    res.json({ success: true, message: "Email restored from trash" });
  })
);

router.delete(
  "/:id",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    await emailService.deleteEmail(req.params.id);
    res.json({ success: true, message: "Email deleted permanently" });
  })
);

router.post(
  "/:id/modify",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { addLabelIds, removeLabelIds } = req.body;
    const labels = await emailService.modifyLabels(req.params.id, {
      addLabelIds,
      removeLabelIds,
    });
    res.json({ success: true, message: "Labels modified", labels });
  })
);

router.post(
  "/batchModify",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { ids, addLabelIds, removeLabelIds } = req.body;
    await emailService.batchModify({ ids, addLabelIds, removeLabelIds });
    res.json({ success: true, message: `Modified ${ids.length} emails` });
  })
);

router.get(
  "/labels",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const labels = await emailService.getLabels();
    res.json({ success: true, labels });
  })
);

router.post(
  "/labels",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { name, labelListVisibility, messageListVisibility } = req.body;
    const label = await emailService.createLabel({
      name,
      labelListVisibility,
      messageListVisibility,
    });
    res.json({ success: true, label });
  })
);

router.put(
  "/labels/:id",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { name, labelListVisibility, messageListVisibility } = req.body;
    const label = await emailService.updateLabel(req.params.id, {
      name,
      labelListVisibility,
      messageListVisibility,
    });
    res.json({ success: true, label });
  })
);

router.delete(
  "/labels/:id",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    await emailService.deleteLabel(req.params.id);
    res.json({ success: true, message: "Label deleted" });
  })
);

router.post(
  "/command",
  auth(),
  emailAuth,
  catchAsync(async (req, res) => {
    const emailService = await createEmailService(req);
    const { prompt } = req.body;
    const { result, message } = await emailService.processEmailCommand(prompt);
    res.json({ success: true, message, data: result });
  })
);

export default router;
