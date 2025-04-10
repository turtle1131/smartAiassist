const textInput = document.getElementById('text-input');
const sendButton = document.getElementById('send-button');
const voiceButton = document.getElementById('voice-button');
const outputDiv = document.getElementById('output');
const liveCam = document.getElementById('live-cam');
const voiceOutputToggle = document.getElementById('voice-output-toggle'); // Get the checkbox

// Use the correct API Key and Vision Model
const OPENROUTER_API_KEY = "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";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_NAME = "google/gemini-pro-vision";

let recognition;
let isRecognizing = false;
let conversationHistory = []; // To store the chat history
const synth = window.speechSynthesis; // Speech Synthesis API
let voices = []; // To store available voices

// --- Speech Synthesis ---
function populateVoiceList() {
  if(typeof synth === 'undefined') {
    console.warn("Speech Synthesis not supported.");
    return;
  }
  voices = synth.getVoices();
  // console.log("Available voices:", voices);
}

// Call populateVoiceList when voices change or initially
populateVoiceList();
if (typeof synth !== 'undefined' && synth.onvoiceschanged !== undefined) {
  synth.onvoiceschanged = populateVoiceList;
}

function speakText(textToSpeak) {
    if (!synth) {
        return; // Already warned in populateVoiceList
    }
    // Optional: Cancel previous speech if interrupting is desired
    // if (synth.speaking) {
    //    synth.cancel();
    // }
    if (synth.speaking) {
         console.warn('SpeechSynthesis is already speaking.');
         return; // Don't interrupt
    }
    if (textToSpeak && textToSpeak.trim() !== '') {
        const utterThis = new SpeechSynthesisUtterance(textToSpeak);
        utterThis.onerror = (event) => {
            console.error('SpeechSynthesisUtterance.onerror', event);
        };
        // Optional: Select a specific voice
        // const selectedVoice = voices.find(voice => voice.lang === 'en-US'); // Example
        // if (selectedVoice) {
        //     utterThis.voice = selectedVoice;
        // }
        synth.speak(utterThis);
    }
}

// --- Display Messages ---
function displayMessage(message, sender) {
    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    messageElement.classList.add(sender === 'user' ? 'user-message' : 'ai-message');
    outputDiv.appendChild(messageElement);
    outputDiv.scrollTop = outputDiv.scrollHeight; // Scroll to the bottom
}

// --- Capture Video Frame ---
function captureVideoFrame() {
    // Check if camera is ready and has dimensions
    if (!liveCam || !liveCam.videoWidth || !liveCam.videoHeight) {
        console.warn("Camera not ready or video dimensions unavailable.");
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = liveCam.videoWidth;
    canvas.height = liveCam.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(liveCam, 0, 0, canvas.width, canvas.height);
    // Return base64 encoded image data (e.g., JPEG)
    return canvas.toDataURL('image/jpeg');
}

// --- Send Message to AI (modified for optional image) ---
async function sendMessageToAI(message, imageDataUrl = null) {
    displayMessage(message, 'user');

    // Construct the user message content
    const userMessageContent = [];
    userMessageContent.push({ type: "text", text: message });
    if (imageDataUrl) {
        // Ensure the base64 string doesn't have the prefix for the API
        const base64Data = imageDataUrl.split(',')[1];
         userMessageContent.push({
            type: "image_url",
            image_url: {
                 url: `data:image/jpeg;base64,${base64Data}` // Correct format for Gemini Pro Vision
            }
        });
    }

    conversationHistory.push({ role: "user", content: userMessageContent });

    // Add a thinking indicator (optional)
    const thinkingElement = document.createElement('p');
    thinkingElement.textContent = 'AI is thinking...';
    thinkingElement.classList.add('ai-message', 'thinking');
    outputDiv.appendChild(thinkingElement);
    outputDiv.scrollTop = outputDiv.scrollHeight;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: MODEL_NAME,
                messages: conversationHistory, // Send history including the new multimodal message
                // Optional: Add max_tokens if needed for vision models
                // max_tokens: 1024
            })
        });

        outputDiv.removeChild(thinkingElement); // Remove thinking indicator

        if (!response.ok) {
            const errorData = await response.json();
            console.error("API Error:", errorData);
            displayMessage(`Error: ${errorData.error?.message || response.statusText}`, 'ai');
            // Remove the last user message from history if AI fails
            conversationHistory.pop();
            return;
        }

        const data = await response.json();
        if (data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
            const aiResponse = data.choices[0].message.content;
            displayMessage(aiResponse, 'ai');
            conversationHistory.push({ role: "assistant", content: aiResponse }); // Add AI response to history

            // Speak the response if the toggle is checked
            if (voiceOutputToggle.checked) {
                speakText(aiResponse);
            }
        } else {
            console.warn("AI response format unexpected or empty:", data);
            displayMessage("AI did not return a valid response.", 'ai');
             // Remove the last user message from history if AI fails
            conversationHistory.pop();
        }

    } catch (error) {
        outputDiv.removeChild(thinkingElement); // Remove thinking indicator
        console.error("Fetch Error:", error);
        displayMessage(`Error sending message: ${error.message}`, 'ai');
         // Remove the last user message from history if AI fails
        conversationHistory.pop();
    }
}

// --- Text Input Handling ---
sendButton.addEventListener('click', () => {
    const message = textInput.value.trim();
    if (message) {
        sendMessageToAI(message); // Send only text for text input
        textInput.value = '';
    }
});

textInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendButton.click();
    }
});

// --- Voice Input Handling (Web Speech API) ---
function setupSpeechRecognition() {
    window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!window.SpeechRecognition) {
        console.warn("Speech Recognition API not supported in this browser.");
        voiceButton.disabled = true;
        voiceButton.textContent = '🚫';
        voiceButton.title = "Speech Recognition not supported";
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false; // Process single utterances
    recognition.lang = 'en-US';
    recognition.interimResults = false; // Get final results only
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log("Voice transcript:", transcript);

        // Capture frame when voice result is final
        let imageData = null;
        try {
            imageData = captureVideoFrame();
            if (imageData) {
                 console.log("Captured video frame.");
            }
        } catch (error) {
            console.error("Error capturing video frame:", error);
            displayMessage("Error capturing video frame.", 'ai');
        }

        // Send transcript and image data (if captured)
        sendMessageToAI(transcript, imageData);
        textInput.value = ''; // Clear input field if needed
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        displayMessage(`Speech error: ${event.error}`, 'ai'); // Display error in chat
    };

    recognition.onend = () => {
        isRecognizing = false;
        voiceButton.textContent = '🎤';
        voiceButton.style.backgroundColor = '#28a745'; // Reset color
        console.log("Speech recognition ended.");
    };

    recognition.onstart = () => {
        isRecognizing = true;
        voiceButton.textContent = '🛑'; // Indicate recording
        voiceButton.style.backgroundColor = '#dc3545'; // Change color while recording
        console.log("Speech recognition started.");
    };
}

voiceButton.addEventListener('click', () => {
    if (!recognition) {
        alert("Speech recognition is not set up or not supported.");
        return;
    }
    if (isRecognizing) {
        recognition.stop();
    } else {
        try {
            // Stop any ongoing speech synthesis before starting recognition
            if (synth && synth.speaking) {
                synth.cancel();
            }
            recognition.start();
        } catch (error) {
            console.error("Error starting recognition:", error);
            // Handle cases where recognition might already be active or fails to start
            isRecognizing = false; // Reset state
             voiceButton.textContent = '🎤';
             voiceButton.style.backgroundColor = '#28a745';
        }
    }
});

// --- Camera Setup ---
async function setupCamera() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            liveCam.srcObject = stream;
            liveCam.onloadedmetadata = () => {
                liveCam.play();
                console.log("Camera stream started.");
            };
        } catch (error) {
            console.error("Error accessing camera:", error);
            alert("Could not access camera. Please ensure permission is granted.");
            const mediaContainer = document.getElementById('media-container');
            const errorMsg = document.createElement('p');
            errorMsg.textContent = `Camera Error: ${error.name} - ${error.message}`;
            errorMsg.style.color = 'red';
            mediaContainer.appendChild(errorMsg);
        }
    } else {
        console.warn("getUserMedia not supported in this browser.");
        alert("Camera access not supported by your browser.");
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    setupSpeechRecognition();
    setupCamera();
    const initialMessage = "Hello! How can I help you today?";
    displayMessage(initialMessage, 'ai'); // Display initial message
    conversationHistory.push({ role: "assistant", content: initialMessage });
    // Do not speak initial message automatically
});