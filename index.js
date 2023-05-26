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
require("dotenv").config();
const app = express();
const port = 8000;
const {
  configure_chatbot,
  identify_prompt_intent,
  resolve_prompt,
} = require("./prompts");
const deepgram = new Deepgram(process.env.voice_key);
// 
const server = [
  "https://memoria.live",
  "https://www.memoria.live",
  "http://www.memoria.live",
  "http://memoria.live",
];
const local = ["http://localhost:3000"];
const current = server;
//
app.use(bodyParser.json());
// const storage = multer.memoryStorage();
const upload = multer();
// set no corsw
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

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const encryptData = (data, secretKey) => {
  const ciphertext = CryptoJS.AES.encrypt(data, secretKey).toString();
  return ciphertext;
};
// 
// Function to decrypt data
const decryptData = (ciphertext, secretKey) => {
  const originalText = CryptoJS.AES.decrypt(ciphertext, secretKey).toString(
    CryptoJS.enc.Utf8
  );
  return originalText;
};

async function makeChatRequest(req, res) {
  const { message, max_tokens } = req.body;

  try {
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
    if(response.data.choices[0].message.content){
      return res.json(response.data.choices[0].message.content);
    }
    return ''
  } catch (error) {
    console.error("Error:", error);
    await sleep(1000);
    // return makeChatRequest(req, res);
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post("/gpt", async (req, res) => {
  try {
    await makeChatRequest(req, res);
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "An error occurred" });
  }
});

app.post("/audio", upload.single("audio"), async (req, res) => {
  try {
    const audioBlob = req.file.buffer;
    console.log("the audioblob is" + audioBlob);
    const formData = new FormData();

    formData.append("file", audioBlob, "audio.mp3");
    formData.append("model", "whisper-1");

    const whisperResponse = await makeAudioTranscriptionRequest(formData);

    // Store the parameter value in the session
    //req.session.recording = audioBlob;
    console.log(whisperResponse);
    const transcript = whisperResponse.data.text;
    res.setHeader("Content-Type", "application/json");
    res.json({ text: transcript });
  } catch (error) {
    console.error("There was an error:", error);
    res.status(500).json({ message: "Error processing audio" });
  }
});

async function makeAudioTranscriptionRequest(formData) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_GPT_PRIVATE_KEY}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );

    return response;
  } catch (error) {
    console.log(error.response.data.error);
    console.error("Error:", error);

    await sleep(1000); // Wait for 1 second before retrying
    // return makeAudioTranscriptionRequest(formData); // Retry the request
    return;
  }
}

app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const audioSource = {
      stream: Readable.from(req.file.buffer),
      mimetype: req.file.mimetype,
    };

    const response = await deepgram.transcription.preRecorded(audioSource, {punctuate: true, model: 'nova', language: 'en-US' });
    const transcription = response.results.channels[0].alternatives[0].transcript;
    res.json({ transcription: transcription });
  } catch (error) {
    console.log("Error:", error.message);
    res.status(500).json({ error: "An error occurred during transcription" });
  }
});

// Helper function to pause execution for a given duration
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// database stuff
app.post("/addNote", async (req, res) => {
  const { user_id, title, content, tags } = req.body;
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
    console.log("Retreiving recording and uploading to db");
    // console.log("What's in session var:")
    // console.log(req.session)
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
      const { data, error } = await supabase.storage
        .from("resources")
        .upload(recording_name, recording, {
          cacheControl: "3600",
          contentType: "audio/mp3",
        });
      // console.log("Recording uploaded: " + recording_name);
      // console.log(data);
      //console.error(error);
    }
  }

  const { data, error } = await supabase
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
    const newTags = await updateTags(user_id);
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
    return {};
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
        tags: note.Tags,
        timestamp: note.created_at, // type timestampz
        thought_recording: note.thought_recording, // supabase path
      };
    });
    return decryptedNotes;
  }
};

//TODO delete this
function combineNotes(notes) {
  let combinedString = "";
  for (let note of notes) {
    const dateOnlyString = new Date(note.timestamp).toISOString().slice(0, 10);
    combinedString +=
      "Date:" +
      dateOnlyString +
      "\nNote:" +
      note.content +
      "\nTags" +
      note.tags.toString() +
      "\n\n";
  }
  return combinedString.trim();
}

// queryUserThoughts
app.post("/queryUserThoughts", async (req, res) => {
  const userId = req.body.userId;
  const messages = req.body.messages;
  const notes = await fetchUserNotes(userId);
  const max_tokens = 200;
  let system_message = configure_chatbot(notes);
  let last_prompt = messages[messages.length - 1].text;
  let prompt_intent = await identify_prompt_intent(last_prompt);

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

  // console.log(response);
  return res.json(response);
});

app.post("/addTags", async (req, res) => {
  const tags = req.body.tags;
  const user_id = req.body.userId; // assuming that the user ID is stored in the `req.user.id` property
  const currentTags = await getCurrentTags(user_id);
  const updatedTags = [...new Set([...currentTags, ...tags])];
  const { error: updateError } = await supabase
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
const getCurrentTags = async (userId) => {
  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("Tags")
    .eq("id", userId)
    .single();

  if (profileError) {
    console.error(profileError);
    res.status(500).send("Error fetching user profile");
    return;
  }
  const currentTags = profileData.Tags || [];
  return currentTags;
};

const deleteNote = async (id) => {
  //
  const { data, error } = await supabase.from("notes").delete().eq("id", id);

  if (error) {
    console.log("Error deleting note:", error);
    return null;
  } else {
    return data;
  }
};
const getAllTags = async (userId) => {
  const { data: notes, error } = await supabase
    .from("notes")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.log("Error fetching Tags:", error);
    return null;
  } else {
    // Decrypt the data before returning it to the frontend
    let tags = [];
    notes.map((note) => {
      if (note.Tags) {
        for (let tag of note.Tags) {
          tags.push(tag);
        }
      }
    });
    return tags;
  }
};

const getDict = (tags) => {
  const counts = {};
  tags.forEach((tag) => {
    // Remove leading and trailing single quotation marks
    if (counts[tag] === undefined) {
      counts[tag] = 1;
    } else {
      counts[tag] += 1;
    }
  });
  return counts;
};

const sendNewTags = async (userId, tags) => {
  const orderedData = [];

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ tags_new: tags })
    .eq("id", userId);

  if (updateError) {
    console.error(updateError);
    return;
  }

  while (Object.keys(tags).length > 0) {
    let maxKey = null;
    let maxValue = -Infinity;

    for (const key in tags) {
      if (tags[key] > maxValue) {
        maxValue = tags[key];
        maxKey = key;
      }
    }
    orderedData.push(maxKey);
    delete tags[maxKey];
  }

  const { error: updateError2 } = await supabase
    .from("profiles")
    .update({ Tags: orderedData })
    .eq("id", userId);

  if (updateError2) {
    console.error("second error:" + updateError);
    return;
  }
  return orderedData;
};

const updateTags = async (userId) => {
  const tags = await getAllTags(userId);
  const counts = {};
  tags.forEach((tag) => {
    // Remove leading and trailing single quotation marks
    if (counts[tag] === undefined) {
      counts[tag] = 1;
    } else {
      counts[tag] += 1;
    }
  });
  const newTags = await sendNewTags(userId, counts);
  return newTags;
};

const fetchNumQueries = async (userId) => {
  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("num_queries")
    .eq("id", userId)
    .single();

  if (profileError) {
    // console.error(profileError);
    // res.status(500).send("Error fetching user profile");
    console.log('profileError')
    return 0;
  }

  const numQueries = profileData.num_queries;
  return numQueries;
};

app.post("/fetchNumQueries", async (req, res) => {
  const userId = req.body.userId;
  const num_queries = await fetchNumQueries(userId);
  res.send(num_queries.toString());
});

const incrNumQueries = async (userId) => {
  console.log("incrNumQueries called");

  const cur_queries = await fetchNumQueries(userId);

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ num_queries: cur_queries + 1 })
    .eq("id", userId);

  if (updateError) {
    console.error(updateError);
    return;
  }
};

app.post("/incrNumQueries", async (req) => {
  const userId = req.body.userId;
  await incrNumQueries(userId);
});

app.post("/fetchUserNotes", async (req, res) => {
  const userId = req.body.userId;
  const notes = await fetchUserNotes(userId);
  res.send(notes);
});

app.post("/getUserTags", async (req, res) => {
  const userId = req.body.userId;
  const tags = await getCurrentTags(userId);
  const tagsFull = await getAllTags(userId);
  const tagsAndCounts = getDict(tagsFull);
  res.send({ tags: tags, counts: tagsAndCounts });
});

app.post("/deleteNote", async (req, res) => {
  const id = req.body.id;
  const userId = req.body.userId;
  const data = await deleteNote(id);
  const newTags = await updateTags(userId);
  res.send(newTags);
});

app.post("/fetchNoteAudio", async (req, res) => {
  const path = req.body.path;
  // console.log("Fetching note from path: " + path);
  // console.log("Fetching note from path: ...")
  try {
    const { data, error } = await supabase.storage
      .from("resources")
      .download(path);

    if (error) {
      console.error(error);
      res.sendStatus(500);
      return;
    }

    // Set the appropriate headers for audio playback
    res.set({
      "Content-Type": "audio/mp3",
      "Content-Disposition": "inline",
    });

    // Pipe the audio data to the response
    // console.log("Note audio found, sending to frontend...");
    res.send(data);
  } catch (error) {
    console.error(error);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || port, () => {
  console.log(`Server running`);
});
