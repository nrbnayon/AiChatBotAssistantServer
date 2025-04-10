// helper\notifyByEmail.js
import nodemailer from "nodemailer";
import { htmlToText } from "html-to-text";
import User from "../models/User.js";

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

// Company constants (replace with your actual values)
const companyName = "Inbox Buddy";
const supportEmail = "support@inboxbuddy.com";
const year = new Date().getFullYear();
const logoUrl = "https://ibb.co.com/PZd0NN3y";
const primaryColor = "#4361EE"; // Modern blue color
const accentColor = "#3A0CA3"; // Darker accent color
const lightGray = "#f8f9fa";
const darkGray = "#343a40";

// Function to replace placeholders in templates
const replacePlaceholders = (template, data) => {
  let result = template;
  for (const key in data) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), data[key]);
  }
  // Replace static placeholders
  result = result.replace(/\[Your Service Name\]/g, companyName);
  result = result.replace(/\[support email\]/g, supportEmail);
  result = result.replace(/\[Year\]/g, year);
  return result;
};

// Common email styles
const commonStyles = `
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  line-height: 1.6;
`;

// Email templates
const waitingListConfirmationTemplate = `
<table width="100%" cellspacing="0" cellpadding="0" style="${commonStyles}">
  <tr>
    <td align="center" style="background-color: #f4f5f7; padding: 20px;">
      <table width="600" cellspacing="0" cellpadding="0" style="border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
        <tr>
          <td style="background-color: ${primaryColor}; padding: 30px; text-align: center;">
            <img src="${logoUrl}" alt="${companyName} Logo" style="max-width: 180px;" />
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 30px; background-color: #ffffff;">
            <h2 style="color: ${accentColor}; margin-top: 0; font-weight: 600;">You're on the Waiting List!</h2>
            <p style="color: #555;">Hello {{name}},</p>
            <p style="color: #555;">Thank you for your interest in ${companyName}. We've successfully added you to our waiting list!</p>
            <div style="background-color: ${lightGray}; border-left: 4px solid ${primaryColor}; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #444;">Our team will carefully review your request, and you'll receive an email as soon as your account is approved.</p>
            </div>
            <p style="color: #555;">Rest assured, your information is secure with us. We take privacy seriously and will never share your data without your consent.</p>
            <p style="color: #555;">Have questions? Feel free to reach out to our support team at <a href="mailto:${supportEmail}" style="color: ${primaryColor}; text-decoration: none; font-weight: 500;">${supportEmail}</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">&copy; ${year} ${companyName}. All rights reserved.</p>
            <p style="margin: 0;"><a href="https://inboxbuddy.com/unsubscribe" style="color: ${primaryColor}; text-decoration: none;">Unsubscribe</a> | <a href="https://inboxbuddy.com/privacy" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
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
            <img src="${logoUrl}" alt="${companyName} Logo" style="max-width: 180px;" />
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
              <a href="https://inboxbuddy.com/admin/waiting-list" style="background-color: ${primaryColor}; color: white; padding: 12px 28px; text-decoration: none; display: inline-block; border-radius: 4px; font-weight: 500; letter-spacing: 0.3px;">Access Admin Panel</a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">&copy; ${year} ${companyName}. All rights reserved.</p>
            <p style="margin: 0;"><a href="https://inboxbuddy.com/privacy" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
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
            <img src="${logoUrl}" alt="${companyName} Logo" style="max-width: 180px;" />
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
            <p style="margin-bottom: 10px;">&copy; ${year} ${companyName}. All rights reserved.</p>
            <p style="margin: 0;"><a href="https://inboxbuddy.com/unsubscribe" style="color: ${primaryColor}; text-decoration: none;">Unsubscribe</a> | <a href="https://inboxbuddy.com/privacy" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
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
            <img src="${logoUrl}" alt="${companyName} Logo" style="max-width: 180px;" />
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
              <a href="https://inboxbuddy.com/dashboard" style="background-color: ${primaryColor}; color: white; padding: 12px 28px; text-decoration: none; display: inline-block; border-radius: 4px; font-weight: 500; letter-spacing: 0.3px;">Go to Dashboard</a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background-color: ${lightGray}; padding: 25px; text-align: center; color: ${darkGray};">
            <p style="margin-bottom: 10px;">&copy; ${year} ${companyName}. All rights reserved.</p>
            <p style="margin: 0;"><a href="https://inboxbuddy.com/unsubscribe" style="color: ${primaryColor}; text-decoration: none;">Unsubscribe</a> | <a href="https://inboxbuddy.com/privacy" style="color: ${primaryColor}; text-decoration: none;">Privacy Policy</a></p>
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
  try {
    await transporter.sendMail({
      from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: `You're on the ${companyName} Waiting List!`,
      html,
      text,
    });
    console.log(`Waiting list confirmation sent to ${user.email}`);
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
  try {
    await transporter.sendMail({
      from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
      to: adminEmails.join(","),
      subject: `New User on Waiting List: ${user.name}`,
      html,
      text,
    });
    console.log(`Admin notification sent to ${adminEmails.join(", ")}`);
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
  try {
    await transporter.sendMail({
      from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: `You're Approved! Welcome to ${companyName}`,
      html,
      text,
    });
    console.log(`Approval confirmation sent to ${user.email}`);
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
  try {
    await transporter.sendMail({
      from: `"${companyName}" <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: `Welcome to ${companyName}! Your Account is Ready`,
      html,
      text,
    });
    console.log(`First login confirmation sent to ${user.email}`);
  } catch (error) {
    console.error(
      `Failed to send first login confirmation to ${user.email}:`,
      error
    );
  }
};
