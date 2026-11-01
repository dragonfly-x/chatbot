document.addEventListener("DOMContentLoaded", function () {
  const chatbotContainer = document.getElementById("chatbot-container");
  const sendBtn = document.getElementById("send-btn");
  const chatbotInput = document.getElementById("chatbot-input");
  const chatbotMessages = document.getElementById("chatbot-messages");
  const chatbotIcon = document.getElementById("chatbot-icon");
  const closeButton = document.getElementById("close-btn");
  const conversation = [];
  let isSending = false;

  chatbotIcon.addEventListener("click", function () {
    chatbotContainer.classList.remove("hidden");
    chatbotIcon.style.display = "none";
    chatbotInput.focus();
  });

  closeButton.addEventListener("click", function () {
    chatbotContainer.classList.add("hidden");
    chatbotIcon.style.display = "flex";
  });

  sendBtn.addEventListener("click", sendMessage);
  chatbotInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  });

  appendMessage("bot", "Hi! Ask me anything and I’ll do my best to help.");

  function sendMessage() {
    const userMessage = chatbotInput.value.trim();
    if (!userMessage || isSending) {
      return;
    }

    chatbotInput.value = "";
    appendMessage("user", userMessage);
    getBotResponse(userMessage);
  }

  function appendMessage(sender, message) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender);
    messageElement.textContent = message;
    chatbotMessages.appendChild(messageElement);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
  }

  async function getBotResponse(userMessage) {
    isSending = true;
    sendBtn.disabled = true;
    chatbotInput.disabled = true;

    if (conversation.length >= 20) {
      conversation.splice(0, 2);
    }
    conversation.push({ role: "user", content: userMessage });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Chat request failed (${response.status}).`);
      }
      if (typeof data.reply !== "string" || !data.reply.trim()) {
        throw new Error("The chatbot returned an empty response. Please try again.");
      }

      conversation.push({ role: "assistant", content: data.reply });
      appendMessage("bot", data.reply);
    } catch (error) {
      conversation.pop();
      console.error("Error fetching chatbot response:", error);
      const detail = error instanceof Error ? error.message : "Unknown network error.";
      appendMessage("bot", `Sorry, I couldn’t answer that: ${detail}`);
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      chatbotInput.disabled = false;
      chatbotInput.focus();
    }
  }
});
