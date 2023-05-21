const express = require("express");
const cors = require("cors");
const axios = require("axios");
const bodyParser = require("body-parser");
const { supabase } = require("./supabaseClient");
const CryptoJS = require("crypto-js");
const multer = require("multer");
const fs = require("fs");
const FormData = require("form-data");
require("dotenv").config();
const app = express();
const port = 8000;
const {
  configure_chatbot,
  identify_prompt_intent,
  resolve_prompt,
} = require("./prompts");

const server = [
  "https://memoria.live",
  "https://www.memoria.live",
  "http://www.memoria.live",
  "http://memoria.live",
];
const local = ["http://localhost:3000"];
const current = server;

app.use(bodyParser.json());
const upload = multer();
// set no corsw
app.use(
  cors({
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
  return res.json(response.data.choices[0].message.content);
});

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
  const { data, error } = await supabase
    .from("notes")
    .insert({
      user_id,
      title: encryptedTitle,
      content: encryptedContent,
      Tags: tags,
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
        tags: note.Tags,
        timestamp: note.created_at, // type timestampz
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

  console.log(response);
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
    let tags = []
    notes.map((note) => {
      for (let tag of note.Tags) {
        tags.push(tag);
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

  while(Object.keys(tags).length > 0) {
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
    console.error('second error:' + updateError);
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
  res.send({tags: tags, counts: tagsAndCounts});
});

app.post("/deleteNote", async (req, res) => {
  const id = req.body.id;
  const userId = req.body.userId;
  const data = await deleteNote(id);
  const newTags = await updateTags(userId);
  res.send(newTags);
});

app.post("/audio", upload.single("audio"), async (req, res) => {
  try {
    const audioBlob = req.file.buffer;
    const formData = new FormData();
    formData.append("model", "whisper-1");
    formData.append("file", audioBlob, "audio.wav");

    const whisperResponse = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.REACT_APP_GPT_PRIVATE_KEY}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );

    const transcript = whisperResponse.data.text;
    res.setHeader("Content-Type", "application/json");
    res.json({ text: transcript });
  } catch (error) {
    console.error("There was an error:", error);
    res.status(500).json({ message: "Error processing audio" });
  }
});

app.listen(process.env.PORT || port, () => {
  console.log(`Server running`);
});
