import nodemailer from "nodemailer";
import { htmlToText } from "html-to-text";
import User from "../models/User.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Get directory name using import.meta
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define paths and URLs
const localLogoPath = path.join(__dirname, "../uploads/images/logo.png");
const logoUrl =
  "https://res.cloudinary.com/dtyxcxze9/image/upload/v1745383375/logo_yxchsq.png";
const fallbackLogoUrl = process.env.BACKENDURL
  ? `${process.env.BACKENDURL}/uploads/images/logo.png`
  : localLogoPath;

// Nodemailer transporter configuration using environment variables
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_PORT == 587 ? false : true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const planLimits = {
  free: { maxInboxes: 1, dailyQueries: 5 },
  basic: { maxInboxes: 1, dailyQueries: 15 },
  premium: { maxInboxes: 3, dailyQueries: 100 },
  enterprise: { maxInboxes: 10, dailyQueries: Infinity },
};

// Company constants
const companyName = "Inbox-Buddy.ai";
const supportEmail = "inboxbuddy.ai@gmail.com";
const year = new Date().getFullYear();
const primaryColor = "#4361EE";
const accentColor = "#3A0CA3";
const lightGray = "#f8f9fa";
const darkGray = "#343a40";
const highlightColor = "#2ec4b6";
const warningColor = "#ff9f1c";

let logoSrc = logoUrl;
if (!logoSrc) logoSrc = fallbackLogoUrl;
if (!logoSrc && fs.existsSync(localLogoPath)) logoSrc = "cid:companyLogo";

// Function to replace placeholders in templates
const replacePlaceholders = (template, data) => {
  let result = template;
  for (const key in data) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), data[key]);
  }
  result = result.replace(/\[Your Service Name\]/g, companyName);
  result = result.replace(/\[support email\]/g, supportEmail);
  result = result.replace(/\[Year\]/g, year);
  // Prioritize Cloudinary URL, fall back to local image if it doesn't exist
  result = result.replace(/cid:companyLogo/g, logoSrc || "");
  return result;
};

// Common email styles
const commonStyles = `
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  line-height: 1.6;
`;

// Email templates (unchanged, using cid:companyLogo which will be replaced)
const waitingListConfirmationTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background-color: ${primaryColor}; padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">You're on the Waiting List!</h2>
            <p style="color: #555;">Hello {{name}},</p>
            <p style="color: #555;">Thank you for your interest in ${companyName}. You've successfully added you to Inbox-Buddy.ai waiting list!</p>
            <div style="background-color: ${lightGray}; border-left: 4px solid ${primaryColor}; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #444;">Our team will carefully review your request, and you'll receive an email as soon as your account is approved.</p>
            </div>
            <p style="color: #555;">Rest assured, your information is secure with us. We take privacy seriously and will never share your data without your consent.</p>
            <p style="color: #555;">Have questions? Feel free to reach out to our support team at <a href="mailto:${supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 500;">${supportEmail}</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
             <a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const adminNotificationTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background-color: ${primaryColor}; padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">New User on Waiting List</h2>
            <p style="color: #555;">A new user has joined the waiting list and requires your approval.</p>
            <table width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">Name</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{name}}</td>
              </tr>
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">Email</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{email}}</td>
              </tr>
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">Inbox</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{inbox}}</td>
              </tr>
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">Description</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{description}}</td>
              </tr>
            </table>
            <p style="color: #555;">Please review and approve or reject this user through the admin panel.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://inbox-buddy.ai/admin/waiting-list" style="background-color: ${primaryColor}; color: white; padding: 12px 28px; text-decoration: none; display: inline-block; border-radius: 4px; font-weight: 500; letter-spacing: 0.3px;">Access Admin Panel</a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
            <p style="margin: 0;"><a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const approvalConfirmationTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background-color: ${primaryColor}; padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">You're Approved! Welcome to ${companyName}</h2>
            <p style="color: #555;">Hello {{name}},</p>
            <p style="color: #555;">Congratulations! 🎉 Your request has been approved, and you can now access your ${companyName} account.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="{{loginLink}}" style="background-color: ${primaryColor}; color: white; padding: 12px 28px; text-decoration: none; display: inline-block; border-radius: 4px; font-weight: 500; letter-spacing: 0.3px;">Log In Now</a>
            </div>
            <p style="color: #555;">${companyName} is an AI-powered email assistant designed to help you manage your inbox efficiently. Here's what you can do:</p>
            <ul style="color: #555; padding-left: 20px;">
              <li style="margin-bottom: 8px;"><strong>Automate responses</strong> to save time and maintain consistency</li>
              <li style="margin-bottom: 8px;"><strong>Prioritize important messages</strong> so you never miss what matters</li>
              <li style="margin-bottom: 8px;"><strong>Organize your inbox</strong> with smart filters and categorization</li>
            </ul>
            <div style="background-color: ${lightGray}; border-left: 4px solid ${primaryColor}; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #444;">To get started, simply log in using OAuth (Google or Microsoft). This ensures a secure connection while providing you with the best experience.</p>
            </div>
            <p style="color: #555;">Your privacy is our priority. We employ industry-standard security measures to protect your information and will never share your data without explicit consent.</p>
            <p style="color: #555;">Questions or need assistance? Reach out to our support team at <a href="mailto:${supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 500;">${supportEmail}</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
            <a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const firstLoginConfirmationTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background-color: ${primaryColor}; padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">Welcome to ${companyName}! Your Account is Ready</h2>
            <p style="color: #555;">Hello {{name}},</p>
            <p style="color: #555;">Welcome aboard! 🚀 Your ${companyName} account has been successfully set up and is ready to use.</p>
            <div style="background-color: ${lightGray}; border-radius: 6px; padding: 20px; margin: 20px 0;">
              <h3 style="color: ${accentColor}; margin-top: 0; font-size: 18px;">Next Steps:</h3>
              <ul style="color: #555; padding-left: 20px; margin-bottom: 0;">
                <li style="margin-bottom: 10px;"><strong>Explore our features</strong> to discover how to manage your emails efficiently</li>
                <li style="margin-bottom: 10px;"><strong>Configure your preferences</strong> to customize your experience</li>
                <li style="margin-bottom: 0;"><strong>Connect additional inboxes</strong> if needed for comprehensive email management</li>
              </ul>
            </div>
            <p style="color: #555;">Your security is our top priority. We use advanced encryption and security protocols to ensure your data remains protected at all times.</p>
            <p style="color: #555;">Need assistance or have questions? Our support team is ready to help at <a href="mailto:${supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 500;">${supportEmail}</a>.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://inbox-buddy.ai/dashboard" style="background-color: ${primaryColor}; color: white; padding: 12px 28px; text-decoration: none; display: inline-block; border-radius: 4px; font-weight: 500; letter-spacing: 0.3px;">Go to Dashboard</a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
            <a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const subscriptionSuccessTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background: linear-gradient(135deg, ${primaryColor}, ${accentColor}); padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">Your {{plan}} Plan is Now Active! 🎉</h2>
            <p style="color: #555;">Hello {{name}},</p>
            <p style="color: #555;">Great news! Your subscription to the <strong>{{plan}} Plan</strong> has been successfully activated. Thank you for choosing ${companyName} as your email management solution.</p>
            <div style="background-color: ${lightGray}; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid ${highlightColor};">
              <h3 style="color: ${accentColor}; margin-top: 0; margin-bottom: 15px; font-size: 18px;">Subscription Details:</h3>
              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #555; font-weight: 600;">Plan:</td>
                  <td style="padding: 8px 0; color: #555; text-align: right;">{{plan}}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555; font-weight: 600;">Start Date:</td>
                  <td style="padding: 8px 0; color: #555; text-align: right;">{{startDate}}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555; font-weight: 600;">Next Billing Date:</td>
                  <td style="padding: 8px 0; color: #555; text-align: right;">{{endDate}}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #555; font-weight: 600;">Auto-Renewal:</td>
                  <td style="padding: 8px 0; color: #555; text-align: right;">Enabled</td>
                </tr>
              </table>
            </div>
            <h3 style="color: ${accentColor}; margin-top: 30px; font-size: 18px;">Your {{plan}} Plan Includes:</h3>
            <table width="100%" cellspacing="0" cellpadding="0" style="margin: 15px 0;">
              <tr>
                <td style="vertical-align: top; padding: 10px;">
                  <div style="background-color: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; height: 100%; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="color: ${primaryColor}; font-size: 24px; text-align: center; margin-bottom: 10px;">
                      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; background-color: rgba(67, 97, 238, 0.1); border-radius: 50%; text-align: center;">
                        📧
                      </span>
                    </div>
                    <h4 style="color: ${darkGray}; text-align: center; margin-top: 0; margin-bottom: 10px;">Connected Inboxes</h4>
                    <p style="color: #555; text-align: center; margin: 0; font-size: 15px;">Up to {{maxInboxes}} email accounts</p>
                  </div>
                </td>
                <td style="vertical-align: top; padding: 10px;">
                  <div style="background-color: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; height: 100%; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div style="color: ${primaryColor}; font-size: 24px; text-align: center; margin-bottom: 10px;">
                      <span style="display: inline-block; width: 50px; height: 50px; line-height: 50px; background-color: rgba(67, 97, 238, 0.1); border-radius: 50%; text-align: center;">
                        🤖
                      </span>
                    </div>
                    <h4 style="color: ${darkGray}; text-align: center; margin-top: 0; margin-bottom: 10px;">Your Daily Queries Limit</h4>
                    <p style="color: #555; text-align: center; margin: 0; font-size: 15px;">{{dailyQueries}}</p>
                  </div>
                </td>
              </tr>
            </table>
            <p style="color: #555;">Ready to experience the full power of ${companyName}? Visit your dashboard to start managing your emails more efficiently:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://inbox-buddy.ai/dashboard" style="background-color: ${primaryColor}; color: white; padding: 14px 32px; text-decoration: none; display: inline-block; border-radius: 6px; font-weight: 500; letter-spacing: 0.3px; font-size: 16px; box-shadow: 0 4px 6px rgba(67, 97, 238, 0.2);">Access Your Dashboard</a>
            </div>
            <p style="color: #555;">If you have any questions about your subscription or need assistance, our support team is available at <a href="mailto:${supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 500;">${supportEmail}</a>.</p>
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
              <p style="color: #555; font-style: italic; font-size: 14px;">Thank you for being part of the ${companyName} community!</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
            <p style="margin: 0; font-size: 14px;">
              <a href="https://inbox-buddy.ai/chat" style="color: ${primaryColor}; text-decoration: none; margin: 0 10px;">Manage Subscription</a> | 
              <a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none; margin: 0 10px;">Privacy Policy</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const subscriptionCancelTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background: linear-gradient(135deg, ${primaryColor}, ${accentColor}); padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">Your Subscription Has Been Cancelled</h2>
            <p style="color: #555;">Hello {{name}},</p>
            <p style="color: #555;">Your subscription with ${companyName} has been cancelled, and your account has been downgraded to the Free plan.</p>
            <div style="background-color: ${lightGray}; border-radius: 8px; padding: 20px; margin: 25px 0; border-left: 4px solid ${warningColor};">
              <h3 style="color: ${accentColor}; margin-top: 0; margin-bottom: 15px; font-size: 18px;">Free Plan Limitations:</h3>
              <ul style="color: #555; padding-left: 20px; margin: 0;">
                <li style="margin-bottom: 10px;">Connected inboxes limited to {{maxInboxesFree}}</li>
                <li style="margin-bottom: 10px;">Daily AI queries limited to {{dailyQueriesFree}}</li>
                <li style="margin-bottom: 10px;">Reduced AI-powered features</li>
              </ul>
            </div>
            <div style="background-color: #fff4eb; border-radius: 8px; padding: 20px; margin: 25px 0; border: 1px dashed ${warningColor};">
              <h4 style="color: ${accentColor}; margin-top: 0; margin-bottom: 10px; font-size: 16px;">We'd Love Your Feedback</h4>
              <p style="color: #555; margin: 0;">We're sorry to see you go. If you have a moment, please let us know why you've decided to cancel by replying to this email.</p>
            </div>
            <p style="color: #555;">If you wish to regain access to premium features, you can resubscribe at any time from your account settings.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://inbox-buddy.ai/account/billing" style="background-color: ${primaryColor}; color: white; padding: 14px 32px; text-decoration: none; display: inline-block; border-radius: 6px; font-weight: 500; letter-spacing: 0.3px; font-size: 16px; box-shadow: 0 4px 6px rgba(67, 97, 238, 0.2);">Resubscribe Now</a>
            </div>
            <p style="color: #555;">If you have any questions, please contact our support team at <a href="mailto:${supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 500;">${supportEmail}</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
            <p style="margin: 0; font-size: 14px;">
              <a href="https://inbox-buddy.ai/chat" style="color: ${primaryColor}; text-decoration: none; margin: 0 10px;">Manage Account</a> | 
              <a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none; margin: 0 10px;">Privacy Policy</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const otpTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background-color: ${primaryColor}; padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">Password Reset OTP</h2>
            <p style="color: #555;">Hello,</p>
            <p style="color: #555;">You have requested to reset your password. Use the following OTP to proceed:</p>
            <div style="background-color: ${lightGray}; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px;">
              {{otp}}
            </div>
            <p style="color: #555; margin-top: 20px;">This OTP is valid for 2 minutes.</p>
            <p style="color: #555;">If you did not request this, please ignore this email or contact support at <a href="mailto:${supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 500;">${supportEmail}</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
            <a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const subscriptionCancelConfirmationTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background-color: ${primaryColor}; padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">Subscription Cancellation Confirmation</h2>
            <p style="color: #555;">Hello {{name}},</p>
            <p style="color: #555;">We have received your request to cancel your subscription. Your subscription will be canceled at the end of your current billing period on {{endDate}}.</p>
            <p style="color: #555;">Until then, you will continue to have access to all the features of your current plan.</p>
            <p style="color: #555;">If you change your mind, you can re-enable auto-renewal from your account settings before the end of the billing period.</p>
            <p style="color: #555;">If you have any questions, please contact our support team at <a href="mailto:${supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 500;">${supportEmail}</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
            <a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

const adminSubscriptionCancelNotificationTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background-color: ${primaryColor}; padding: 30px; text-align: center;">
            <img src="cid:companyLogo" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">Subscription Cancellation Notification</h2>
            <p style="color: #555;">A subscription has been canceled.</p>
            <table width="100%" cellspacing="0" cellpadding="0" style="margin: 20px 0; border-collapse: collapse;">
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">User Name</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{userName}}</td>
              </tr>
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">User Email</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{userEmail}}</td>
              </tr>
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">Plan</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{plan}}</td>
              </tr>
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">Cancellation Type</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{cancellationType}}</td>
              </tr>
              <tr>
                <td style="padding: 12px 15px; background-color: ${lightGray}; font-weight: 600; width: 130px; border-bottom: 1px solid #e9ecef;">Effective Date</td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">{{effectiveDate}}</td>
              </tr>
            </table>
            <p style="color: #555;">Please review the user's account if necessary.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">© ${year} ${companyName}. All rights reserved.</p>
            <a href="https://inbox-buddy.ai/about" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`;

// Function to get admin emails
const getAdminEmails = async () => {
  const admins = await User.find({
    role: { $in: ["admin", "super_admin"] },
  }).select("email");
  return admins.map((admin) => admin.email);
};

// Email sending functions
export const sendWaitingListConfirmation = async (user) => {
  const html = replacePlaceholders(waitingListConfirmationTemplate, {
    name: user.name,
  });
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: `You're on the ${companyName} Waiting List!`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(
      `Failed to send waiting list confirmation to ${user.email}:`,
      error
    );
  }
};

export const sendAdminNotification = async (user) => {
  const adminEmails = await getAdminEmails();
  if (adminEmails.length === 0) {
    console.warn("No admins found to notify.");
    return;
  }
  const html = replacePlaceholders(adminNotificationTemplate, {
    name: user.name,
    email: user.email,
    inbox: user.inbox || "Not provided",
    description: user.description || "Not provided",
  });
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: adminEmails.join(","),
    subject: `New User on Waiting List: ${user.name}`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(`Failed to send admin notification:`, error);
  }
};

export const sendApprovalConfirmation = async (user, loginLink) => {
  const html = replacePlaceholders(approvalConfirmationTemplate, {
    name: user.name,
    loginLink,
  });
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: `You're Approved! Welcome to ${companyName}`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(
      `Failed to send approval confirmation to ${user.email}:`,
      error
    );
  }
};

export const sendFirstLoginConfirmation = async (user) => {
  const html = replacePlaceholders(firstLoginConfirmationTemplate, {
    name: user.name,
  });
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: `Welcome to ${companyName}! Your Account is Ready`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(
      `Failed to send first login confirmation to ${user.email}:`,
      error
    );
  }
};

export const sendSubscriptionSuccessEmail = async (user) => {
  const planDetails = planLimits[user.subscription.plan];
  const maxInboxes = planDetails.maxInboxes;
  const dailyQueries =
    planDetails.dailyQueries === Infinity
      ? "Unlimited"
      : planDetails.dailyQueries;

  const html = replacePlaceholders(subscriptionSuccessTemplate, {
    name: user.name,
    plan:
      user.subscription.plan.charAt(0).toUpperCase() +
      user.subscription.plan.slice(1),
    startDate: new Date(user.subscription.startDate).toLocaleDateString(),
    endDate: new Date(user.subscription.endDate).toLocaleDateString(),
    maxInboxes: maxInboxes,
    dailyQueries: dailyQueries,
  });
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: `Subscription Activated Successfully`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(
      `Failed to send subscription success email to ${user.email}:`,
      error
    );
  }
};

export const sendSubscriptionCancelConfirmation = async (user, endDate) => {
  const html = replacePlaceholders(subscriptionCancelConfirmationTemplate, {
    name: user.name,
    endDate: endDate.toLocaleDateString(),
  });
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: `Subscription Cancellation Confirmation`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(
      `Failed to send cancellation confirmation to ${user.email}:`,
      error
    );
  }
};

export const sendAdminSubscriptionCancelNotification = async (
  user,
  cancellationType,
  effectiveDate
) => {
  const adminEmails = await getAdminEmails();
  if (adminEmails.length === 0) {
    console.warn("No admins found to notify.");
    return;
  }
  const html = replacePlaceholders(
    adminSubscriptionCancelNotificationTemplate,
    {
      userName: user.name,
      userEmail: user.email,
      plan: user.subscription.plan,
      cancellationType,
      effectiveDate: effectiveDate.toLocaleDateString(),
    }
  );
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: adminEmails.join(","),
    subject: `Subscription Cancellation: ${user.name}`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(`Failed to send admin notification:`, error);
  }
};

export const sendOTPEmail = async (email, otp) => {
  const html = replacePlaceholders(otpTemplate, { otp });
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: `Your OTP for Password Reset`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
    console.log(`OTP email sent to ${email}`);
  } catch (error) {
    console.error(`Failed to send OTP email to ${email}:`, error);
    throw error;
  }
};

export const sendSubscriptionCancelEmail = async (user) => {
  const freePlanDetails = planLimits["free"];
  const maxInboxesFree = freePlanDetails.maxInboxes;
  const dailyQueriesFree =
    freePlanDetails.dailyQueries === Infinity
      ? "Unlimited"
      : freePlanDetails.dailyQueries;
  const html = replacePlaceholders(subscriptionCancelTemplate, {
    name: user.name,
    // endDate: new Date(user.subscription.endDate).toLocaleDateString(),
    maxInboxesFree: maxInboxesFree,
    dailyQueriesFree: dailyQueriesFree,
  });
  const text = htmlToText(html, { wordwrap: 130 });
  const mailOptions = {
    from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: `Subscription Cancelled`,
    html,
    text,
  };
  if (fs.existsSync(localLogoPath) && !logoUrl) {
    mailOptions.attachments = [
      {
        filename: "logo.png",
        path: logoUrl || localLogoPath,
        cid: "companyLogo",
      },
    ];
  }
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(
      `Failed to send subscription cancellation email to ${user.email}:`,
      error
    );
  }
};
