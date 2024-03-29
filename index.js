const express = require("express");
const session = require("express-session");
const cors = require("cors");
const axios = require("axios");
const bodyParser = require("body-parser");
const { supabase } = require("./supabaseClient");
const CryptoJS = require("crypto-js");
const crypto = require("crypto");
const multer = require("multer");
const { Deepgram } = require("@deepgram/sdk");
const fs = require("fs");
const FormData = require("form-data");
const { Readable } = require("stream");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
const {
  encryptData,
  decryptData,
  authenticateAndAuthorize,
  generateJwtToken,
} = require("./encryption");
const {
  makeChatRequest,
  makeChatRequestTemp,
  getAllTags,
  makeAudioTranscriptionRequest,
  fetchUserNotes,
  getCurrentTags,
  deleteNote,
  getDict,
  sendNewTags,
  updateTags,
  fetchNumQueries,
} = require("./dataops");
require("dotenv").config();
const app = express();
const port = 8000;
const {
  configure_chatbot,
  identify_prompt_intent,
  resolve_prompt,
} = require("./prompts");
const deepgram = new Deepgram(process.env.voice_key);
const upload = multer();
const server = [
  "https://memoria.live",
  "https://www.memoria.live",
  "http://www.memoria.live",
  "http://memoria.live",
];
const local = ["http://localhost:3000"];
const current = server;

const attachSupabaseClient = (req, res, next) => {
  try {
    const supabaseClient = createClient(
      process.env.REACT_APP_SUPABASE_URL || "",
      process.env.REACT_APP_SUPABASE_PUBLIC_KEY_ANON || "",
      {
        global: {
          headers: {
            Authorization: `bearer ${req.headers.authorization}`,
          },
        },
      }
    );

    req.supabaseClient = supabaseClient;
    next();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

app.use(bodyParser.json());
app.use(
  cors({
    origin: current,
    credentials: true,
  })
);

const secretKey = crypto.randomBytes(32).toString("hex");
app.use(
  session({
    secret: secretKey,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(attachSupabaseClient);

// increase timeout on the server
app.use((req, res, next) => {
  req.setTimeout(120000);
  res.setTimeout(120000);
  next();
});

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/login", async (req, res) => {
  const supabaseClient = createClient(
    process.env.REACT_APP_SUPABASE_URL || "",
    process.env.REACT_APP_SUPABASE_PUBLIC_KEY_ANON || "",
    {
      global: {
        headers: {
          Authorization: `bearer ${req.headers.authorization}`,
        },
      },
    }
  );
  try {
    const { data, error } = await supabaseClient.from("profiles").select("*");
    if (error) throw error;
    res.status(200).json({ data });
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
});

app.post("/gpt/:user_id", authenticateAndAuthorize, async (req, res) => {
  const { user_id } = req.params;
  if (user_id !== req.body.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  try {
    await makeChatRequest(req, res);
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "An error occurred" });
  }
});

app.post(
  "/audio/:user_id",
  authenticateAndAuthorize,
  upload.single("audio"),
  async (req, res) => {
    const { user_id } = req.params;
    if (user_id !== req.body.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const audioBlob = req.file.buffer;
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.mp3");
      formData.append("model", "whisper-1");
      const whisperResponse = await makeAudioTranscriptionRequest(formData);
      const transcript = whisperResponse.data.text;
      res.setHeader("Content-Type", "application/json");
      res.json({ text: transcript });
    } catch (error) {
      console.error("There was an error:", error);
      res.status(500).json({ message: "Error processing audio" });
    }
  }
);

app.post(
  "/transcribe/:user_id",
  authenticateAndAuthorize,
  upload.single("audio"),
  async (req, res) => {
    if (!req.file.buffer) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const audioSource = {
        stream: Readable.from(req.file.buffer),
        mimetype: req.file.mimetype,
      };

      const response = await deepgram.transcription.preRecorded(audioSource, {
        punctuate: true,
        model: "nova",
        language: "en-US",
      });
      const transcription =
        response.results.channels[0].alternatives[0].transcript;
      res.json({ transcription: transcription });
    } catch (error) {
      console.log("Error:", error.message);
      res.status(500).json({ error: "An error occurred during transcription" });
    }
  }
);

// database stuff
app.post("/addNote/:user_id", authenticateAndAuthorize, async (req, res) => {
  const supabaseClient = req.supabaseClient;
  const { user_id } = req.params;
  // console.log("user_id:", user_id);
  // console.log("req.body:", req.body.userId);
  if (user_id !== req.body.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const { title, content, tags } = req.body;
  const encryptedContent = encryptData(
    content,
    process.env.REACT_APP_DECRYPTION_KEY
  );
  const encryptedTitle = encryptData(
    title,
    process.env.REACT_APP_DECRYPTION_KEY
  );

  let recording_name = null;
  if (req.session.recording != null) {
    const recording = Buffer.from(req.session.recording);
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    recording_name =
      "thought_recordings/" +
      user_id +
      "/recording_" +
      timestamp +
      randomString +
      ".mp3";
    if (recording) {
      //only save recording if it's found in the session
      const { data, error } = await supabaseClient.storage
        .from("resources")
        .upload(recording_name, recording, {
          cacheControl: "3600",
          contentType: "audio/mp3",
        });
      console.log(error);
    }
  }

  const { data, error } = await supabaseClient
    .from("notes")
    .insert({
      user_id,
      title: encryptedTitle,
      content: encryptedContent,
      Tags: tags,
      thought_recording: recording_name,
    })
    .single();

  if (error) {
    console.error(error);
    res.status(500).json({ error: "Error inserting new note" });
  } else {
    const newTags = await updateTags(user_id, supabaseClient);
    res.status(200).json(data);
  }

  // const numNotes = await fetchUserNotes(user_id).length;
});

app.get("/fetchNotes/:user_id", authenticateAndAuthorize, async (req, res) => {
  const supabaseClient = req.supabaseClient;
  const { user_id } = req.params;
  try {
    const decryptedNotes = await fetchUserNotes(user_id, supabaseClient);
    res.json(decryptedNotes);
  } catch (error) {
    console.error("Error fetching notes:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// queryUserThoughts
app.post(
  "/queryUserThoughts/:user_id",
  authenticateAndAuthorize,
  async (req, res) => {
    const supabaseClient = req.supabaseClient;
    const { user_id } = req.params;
    if (user_id !== req.body.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const userId = req.body.userId;
    const messages = req.body.messages;
    const notes = await fetchUserNotes(userId, supabaseClient);
    const max_tokens = 200;
    let system_message = configure_chatbot(notes);
    let last_prompt = messages[messages.length - 1].text;
    let prompt_intent = await identify_prompt_intent(last_prompt);
    // console.log(prompt_intent);

    let processed_messages = [];
    for (let i = 0; i < messages.length; i++) {
      const role = messages[i].role;
      const content = messages[i].text;
      const dict = { role, content };
      processed_messages.push(dict);
    }
    const dict = { role: "system", content: system_message };
    processed_messages.unshift(dict);
    const response = await resolve_prompt(prompt_intent, processed_messages);
    return res.json(response);
  }
);

app.post("/addTags/:user_id", authenticateAndAuthorize, async (req, res) => {
  const supabaseClient = req.supabaseClient;
  const { user_id } = req.params;
  if (user_id !== req.body.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const tags = req.body.tags;
  const currentTags = await getCurrentTags(user_id, supabaseClient);
  const updatedTags = [...new Set([...currentTags, ...tags])];
  const { error: updateError } = await supabaseClient
    .from("profiles")
    .update({ Tags: updatedTags })
    .eq("id", user_id);

  if (updateError) {
    console.error(updateError);
    res.status(500).send("Error updating user profile");
    return;
  }
  res.status(200).send("Tags updated successfully");
});
//
app.post(
  "/fetchNumQueries/:user_id",
  authenticateAndAuthorize,
  async (req, res) => {
    const supabaseClient = req.supabaseClient;
    const { user_id } = req.params;
    const userId = req.body.userId;
    const num_queries = await fetchNumQueries(userId, supabaseClient);
    res.send(num_queries.toString());
  }
);

const incrNumQueries = async (userId, supabaseClient) => {
  const cur_queries = await fetchNumQueries(userId, supabaseClient);
  const { error: updateError } = await supabaseClient
    .from("profiles")
    .update({ num_queries: cur_queries + 1 })
    .eq("id", userId);

  if (updateError) {
    console.log("Error updating num_queries");
    console.error(updateError);
    return;
  }
  // console.log(cur_queries)
  return cur_queries + 1;
};

app.post(
  "/incrNumQueries/:user_id",
  authenticateAndAuthorize,
  async (req, res) => {
    const supabaseClient = req.supabaseClient;
    const { user_id } = req.params;

    if (user_id !== req.body.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const userId = req.body.userId;
    const num = await incrNumQueries(userId, supabaseClient);
    // console.log(num)
    res.send(num.toString());
  }
);

app.post(
  "/getUserTags/:user_id",
  authenticateAndAuthorize,
  async (req, res) => {
    const supabaseClient = req.supabaseClient;
    const { user_id } = req.params;
    if (user_id !== req.body.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const userId = req.body.userId;
    const tags = await getCurrentTags(userId, supabaseClient);
    const tagsFull = await getAllTags(userId, supabaseClient);
    const tagsAndCounts = getDict(tagsFull);
    res.send({ tags: tags, counts: tagsAndCounts });
  }
);

app.post("/deleteNote/:user_id", authenticateAndAuthorize, async (req, res) => {
  const supabaseClient = req.supabaseClient;
  const id = req.body.id;
  const userId = req.body.userId;
  const data = await deleteNote(id, supabaseClient);
  const newTags = await updateTags(userId, supabaseClient);
  res.send(newTags);
});

app.post("/updateNote/:user_id", authenticateAndAuthorize, async (req, res) => {
  const supabaseClient = req.supabaseClient;
  const id = req.body.id;
  const title = req.body.title;
  const content = req.body.content;
  const tags = req.body.tags;
  const titleEncrypted = encryptData(
    title,
    process.env.REACT_APP_DECRYPTION_KEY
  );
  const contentEncrypted = encryptData(
    content,
    process.env.REACT_APP_DECRYPTION_KEY
  );
  try {
    const { data, error } = await supabaseClient
      .from("notes")
      .update({ title: titleEncrypted, content: contentEncrypted, Tags: tags })
      .match({ id: id });
    if (error) {
      console.error("Error Updating note:", error);
      res.status(500).json({ message: "Internal Server Error" });
      return;
    }
    res.status(200).json({ message: "Note Updated" });
  } catch (error) {
    console.error("Error Updating note:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post(
  "/fetchNoteAudio/:userid",
  authenticateAndAuthorize,
  async (req, res) => {
    const supabaseClient = req.supabaseClient;
    const { user_id } = req.params;
    if (user_id !== req.body.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const path = req.body.path;
    try {
      const { data, error } = await supabaseClient.storage
        .from("resources")
        .download(path);

      if (error) {
        console.error(error);
        res.sendStatus(500);
        return;
      }

      res.set({
        "Content-Type": "audio/mp3",
        "Content-Disposition": "inline",
      });

      res.send(data);
    } catch (error) {
      console.error(error);
      res.sendStatus(500);
    }
  }
);

const server2 = app.listen(process.env.PORT || port, () => {
  console.log(`Server running`);
});

server2.setTimeout(200000);
