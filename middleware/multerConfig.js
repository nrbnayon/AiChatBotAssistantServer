// middleware\multerConfig.js
import multer from "multer";
import path from "path";
import fs from "fs";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/images");
  },
  filename: (req, file, cb) => {
    // Use the user's ID as the filename if available
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return cb(new Error("User ID not found"), null);
    }

    // Get file extension from original filename
    const ext = path.extname(file.originalname).toLowerCase();
    const newFilename = `${userId}${ext}`;

    // Check if a file with this name already exists and remove it
    const filePath = path.join("uploads/images", newFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    cb(null, newFilename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png|gif/;
    const extname = fileTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = fileTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Only images (jpeg, jpg, png, gif) are allowed"));
    }
  },
});

export default upload;
