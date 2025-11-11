# Email AI Assistant - Inbox-Buddy.ai

An intelligent email management system powered by AI that helps users manage their emails efficiently through natural language interactions.

## Features

- **Multi-Provider Email Support**: Gmail, Outlook integration
- **AI-Powered Email Management**: Chat with your inbox using natural language
- **Smart Email Filtering**: Automatic categorization and importance detection
- **Email Operations**: Send, reply, draft, and organize emails
- **Subscription Management**: Multiple pricing tiers with Stripe integration
- **Admin Dashboard**: User management and analytics
- **Authentication**: OAuth 2.0 (Google, Microsoft) and local auth
- **Rate Limiting**: Intelligent query limits based on subscription tier

## Tech Stack

### Backend
- **Runtime**: Node.js with Express.js
- **Database**: MongoDB with Mongoose
- **Authentication**: Passport.js (Google OAuth, Microsoft OAuth)
- **AI Models**: OpenAI GPT-4, Groq (Llama models)
- **Payment Processing**: Stripe
- **Email Services**: Gmail API, Microsoft Graph API
- **File Processing**: PDF.js, Mammoth (DOCX)
- **Session Management**: Express Session with MongoDB store

### Security
- JWT-based authentication
- AES-256-GCM encryption for sensitive tokens
- Rate limiting middleware
- CORS protection
- Row-level security principles

## Installation

### Prerequisites
- Node.js (v18 or higher)
- MongoDB instance
- Google Cloud Console project (for Gmail integration)
- Microsoft Azure app (for Outlook integration)
- Stripe account (for payments)
- OpenAI API key
- Groq API key

### Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=production
PORT=4000
IP_ADDRESS=127.0.0.1
BACKENDURL=https://server.inbox-buddy.ai

# Frontend URLs
FRONTEND_URL=http://localhost:3000
FRONTEND_LIVE_URL=https://inbox-buddy.ai

# Database
MONGODB_URI=your_mongodb_connection_string

# JWT Secrets
JWT_SECRET=your_jwt_secret_key
REFRESH_TOKEN_SECRET=your_refresh_token_secret
JWT_EXPIRE_IN=15d
JWT_REFRESH_EXPIRES_IN=30d

# Encryption
ENCRYPTION_KEY=your_32_byte_hex_encryption_key

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/v1/auth/google/callback
GOOGLE_LIVE_REDIRECT_URI=https://server.inbox-buddy.ai/api/v1/auth/google/callback

# Microsoft OAuth
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_REDIRECT_URI=http://localhost:4000/api/v1/auth/microsoft/callback
MICROSOFT_LIVE_REDIRECT_URI=https://server.inbox-buddy.ai/api/v1/auth/microsoft/callback

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
STRIPE_PRICE_FREE=price_id_for_free
STRIPE_PRICE_BASIC=price_id_for_basic
STRIPE_PRICE_PREMIUM=price_id_for_premium
STRIPE_PRICE_ENTERPRISE=price_id_for_enterprise

# AI API Keys
OPENAI_API_KEY=your_openai_api_key
GROQ_API_KEY=your_groq_api_key

# Email Configuration (for notifications)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=noreply@inbox-buddy.ai

# Admin Configuration
ADMIN_NAME=Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secure_admin_password
```

### Installation Steps

1. Clone the repository:
```bash
git clone <repository-url>
cd email-ai-assistant-server
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (see above)

4. Start the server:

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

**With PM2 (recommended for production):**
```bash
npm run start:pm2:prod
```

## API Endpoints

### Authentication
- `GET /api/v1/auth/oauth/:provider` - OAuth login
- `GET /api/v1/auth/:provider/callback` - OAuth callback
- `POST /api/v1/auth/login` - Local login
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/refresh` - Refresh access token
- `GET /api/v1/auth/logout` - Logout

### User Management
- `GET /api/v1/users/me` - Get current user
- `PUT /api/v1/users/profile` - Update profile
- `DELETE /api/v1/users/me` - Delete account
- `GET /api/v1/users/keywords` - Get email keywords
- `POST /api/v1/users/keywords` - Add keyword
- `DELETE /api/v1/users/keywords/:keyword` - Remove keyword

### Email Operations
- `GET /api/v1/emails` - Fetch emails
- `GET /api/v1/emails/important` - Get important emails
- `GET /api/v1/emails/:emailId` - Get specific email
- `POST /api/v1/emails/send` - Send email
- `POST /api/v1/emails/reply/:emailId` - Reply to email
- `POST /api/v1/emails/draft` - Create draft
- `DELETE /api/v1/emails/trash/:emailId` - Trash email
- `PATCH /api/v1/emails/mark-as-read/:emailId` - Mark as read
- `GET /api/v1/emails/all/search` - Search emails

### AI Assistant
- `POST /api/v1/ai-assistant` - Start new chat
- `POST /api/v1/ai-assistant/:chatId` - Continue chat

### Chat Management
- `POST /api/v1/chats` - Create chat
- `GET /api/v1/chats` - Get all chats
- `GET /api/v1/chats/:id` - Get chat by ID
- `PUT /api/v1/chats/:id` - Update chat
- `DELETE /api/v1/chats/:id` - Delete chat

### Subscription Management
- `POST /api/v1/stripe/create-checkout-session` - Create subscription
- `POST /api/v1/stripe/verify-session` - Verify payment
- `POST /api/v1/stripe/cancel-subscription` - Cancel subscription
- `POST /api/v1/stripe/cancel-auto-renew` - Disable auto-renew
- `POST /api/v1/stripe/enable-auto-renew` - Enable auto-renew

### Admin Endpoints
- `GET /api/v1/users/admin/users` - Get all users
- `POST /api/v1/users/admin/users` - Create user
- `PUT /api/v1/users/admin/users/:id` - Update user
- `DELETE /api/v1/users/admin/users/:id` - Delete user
- `GET /api/v1/users/admin/waiting-list` - Get waiting list
- `POST /api/v1/users/waiting-list/approve` - Approve user
- `POST /api/v1/users/waiting-list/reject` - Reject user

## Subscription Plans

| Plan | Daily Queries | Max Inboxes | Features |
|------|--------------|-------------|----------|
| Free | 5 | 1 | Basic email operations |
| Basic | 15 | 1 | Enhanced AI features |
| Premium | Unlimited | 3 | All features + priority support |
| Enterprise | Unlimited | 10 | Custom solutions + dedicated support |

## AI Models

The system supports multiple AI models with automatic fallback:
- GPT-4o (OpenAI)
- GPT-4o Mini (OpenAI)
- Llama 3.3 70B (Meta via Groq)
- Llama 3.1 8B (Meta via Groq)
- Gemma 2 9B (Google via Groq)

## Security Features

- **Token Encryption**: AES-256-GCM encryption for OAuth tokens
- **JWT Authentication**: Secure token-based auth with refresh tokens
- **Rate Limiting**: Per-endpoint rate limits based on user tier
- **CORS Protection**: Configured allowed origins
- **Input Validation**: Comprehensive request validation
- **Session Management**: Secure session handling
- **Password Hashing**: bcrypt for password security

## Project Structure

```
├── config/                 # Configuration files
│   ├── database.js        # MongoDB connection
│   ├── passport.js        # OAuth strategies
│   └── seedAdmin.js       # Admin seeding
├── controllers/           # Request handlers
├── helper/                # Utility functions
├── middleware/            # Express middleware
├── models/                # Mongoose models
├── routes/                # API routes
├── services/              # Business logic
│   ├── emailService.js   # Email service abstraction
│   ├── gmailService.js   # Gmail implementation
│   ├── outlookService.js # Outlook implementation
│   └── mcpServer.js      # AI chat service
├── utils/                 # Utility functions
├── uploads/               # File uploads
└── index.js              # Entry point
```

## Deployment

### PM2 Configuration

The project includes a PM2 ecosystem file (`ecosystem.config.cjs`) for production deployment:

```bash
# Start with PM2
npm run start:pm2:prod

# Monitor
npm run monit:pm2

# View logs
npm run logs:pm2

# Stop
npm run stop:pm2
```

### Environment-Specific Settings

- **Development**: Uses local URLs, verbose logging
- **Production**: Uses live URLs, optimized caching, PM2 clustering

## Monitoring and Logs

Logs are stored in the `logs/` directory:
- `err.log` - Error logs
- `out.log` - Standard output
- `server-monitor.log` - Server health logs
- `uncaught-exceptions.log` - Uncaught exception logs
- `unhandled-rejections.log` - Unhandled promise rejections

## Error Handling

The application includes comprehensive error handling:
- Global error handler with development/production modes
- Async error catching middleware
- MongoDB error transformation
- Funny developer error messages (development only)
- Client-friendly error messages (production)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

Proprietary - All rights reserved

## Support

For support, email: inboxbuddy.ai@gmail.com

## Authors

- **Nayon** - Backend Developer

## Acknowledgments

- OpenAI for GPT models
- Meta for Llama models
- Google for Gmail API
- Microsoft for Graph API
- Stripe for payment processing
