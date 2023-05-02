const express = require("express");
const cors = require("cors");
const axios = require("axios");
const bodyParser = require("body-parser");
const { supabase } = require("./supabaseClient");
const CryptoJS = require("crypto-js");
require("dotenv").config();
const app = express();
const port = 8000;
const server = ["https://memoria-ai.github.io"];
const local = ["http://localhost:3000"];
const current = server;
app.use(bodyParser.json());

// set no cors
app.use(
  cors({
    // set no cors
    origin: current,
  })
);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const encryptData = (data, secretKey) => {
  const ciphertext = CryptoJS.AES.encrypt(data, secretKey).toString();
  return ciphertext;
};

// Function to decrypt data
const decryptData = (ciphertext, secretKey) => {
  const originalText = CryptoJS.AES.decrypt(ciphertext, secretKey).toString(
    CryptoJS.enc.Utf8
  );
  return originalText;
};

app.post("/gpt", async (req, res) => {
  const { message, max_tokens } = req.body;
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: message }],
      max_tokens: max_tokens,
      n: 1,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.REACT_APP_GPT_PRIVATE_KEY,
      },
    }
  );
  console.log(response.data.choices[0].message.content);
  return res.json(response.data.choices[0].message.content);
});

// database stuff
app.post("/addNote", async (req, res) => {
  const { user_id, title, content } = req.body;
  const encryptedContent = encryptData(
    content,
    process.env.REACT_APP_DECRYPTION_KEY
  );
  const encryptedTitle = encryptData(
    title,
    process.env.REACT_APP_DECRYPTION_KEY
  );
  const { data, error } = await supabase
    .from("notes")
    .insert({ user_id, title: encryptedTitle, content: encryptedContent })
    .single();

  if (error) {
    console.error(error);
    res.status(500).json({ error: "Error inserting new note" });
  } else {
    res.status(200).json(data);
  }
});

const fetchUserNotes = async (userId) => {
  const { data: notes, error } = await supabase
    .from("notes")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.log("Error fetching notes:", error);
    return null;
  } else {
    // Decrypt the data before returning it to the frontend
    const decryptedNotes = notes.map((note) => {
      const decryptedContent = decryptData(
        note.content,
        process.env.REACT_APP_DECRYPTION_KEY
      );
      const decryptedTitle = decryptData(
        note.title,
        process.env.REACT_APP_DECRYPTION_KEY
      );
      return {
        ...note,
        title: decryptedTitle,
        content: decryptedContent,
      };
    });
    return decryptedNotes;
  }
};

function combineNotes(notes) {
  let combinedString = "";
  for (let note of notes) {
    combinedString += note.title + "\n" + note.content + "\n\n";
  }
  return combinedString.trim();
}

// queryUserThoughts
app.post("/queryUserThoughts", async (req, res) => {
  const userId = req.body.userId;
  const searchQuery = req.body.searchTerm;
  const notes = await fetchUserNotes(userId);
  const max_tokens = 200;
  const message =
    "I am a bot that can help you remember your thoughts, and expand/answer questions about them. I can help you remember your thoughts by searching through your notes. You can ask me to search for a specific thought by typing 'search for' followed by your search query. For example, you can type 'search for my birthday', or 'what was the football idea I had'. Here are the notes: " +
    combineNotes(notes) +
    "";
  const userMessage = "\n search query: " + searchQuery;
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: message },
        { role: "user", content: userMessage },
      ],
      max_tokens: max_tokens,
      n: 1,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.REACT_APP_GPT_PRIVATE_KEY,
      },
    }
  );
  console.log("there");
  console.log(response.data.choices[0].message.content);
  return res.json(response.data.choices[0].message.content);
});

const deleteNote = async (id) => {
  const { data, error } = await supabase.from("notes").delete().eq("id", id);

  if (error) {
    console.log("Error deleting note:", error);
    return null;
  } else {
    return data;
  }
};

app.post("/fetchUserNotes", async (req, res) => {
  const userId = req.body.userId;
  const notes = await fetchUserNotes(userId);
  res.send(notes);
});

app.post("/deleteNote", async (req, res) => {
  const id = req.body.id;
  const data = await deleteNote(id);
  res.send(data);
});

app.listen(process.env.PORT || port, () => {
  console.log(`Server running`);
});
