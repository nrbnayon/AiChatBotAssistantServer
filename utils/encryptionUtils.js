// utils\encryptionUtils.js
import crypto from "crypto";

const algorithm = "aes-256-gcm";
const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex"); //32-byte key from .env variable

if (key.length !== 32) {
  throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
}

const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return { iv: iv.toString("hex"), encryptedData: encrypted, authTag };
};

const decrypt = (encryption) => {
  try {
    const decipher = crypto.createDecipheriv(
      algorithm,
      key,
      Buffer.from(encryption.iv, "hex")
    );
    decipher.setAuthTag(Buffer.from(encryption.authTag, "hex"));
    let decrypted = decipher.update(encryption.encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    console.log("[DEBUG] Decrypted token:", decrypted.substring(0, 10) + "...");
    return decrypted;
  } catch (error) {
    console.error("[ERROR] Decryption failed:", error.message);
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Decryption failed");
  }
};

const sampleJWT = "header.payload.signature";
const encrypted = encrypt(sampleJWT);
const decrypted = decrypt(encrypted);
// console.log(decrypted === sampleJWT);

export { encrypt, decrypt };
