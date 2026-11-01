# Groq Chatbot

## Run locally

1. Copy `.env.example` to `.env`.
2. Replace `replace_with_your_groq_api_key` with your Groq API key. Keep `.env` private; it is excluded by `.gitignore`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

The browser sends chat messages to the local `/api/chat` endpoint. The Node server reads `GROQ_API_KEY` from its environment and calls Groq, so the key is never sent to or stored in browser code.

For deployment, set `GROQ_API_KEY` in the hosting provider's secret/environment-variable settings, set `ALLOWED_ORIGINS` to the exact origin(s) serving the app, and use HTTPS. Do not publish `.env` or put the key in JavaScript or HTML.
