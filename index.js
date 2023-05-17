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

const server = ["https://memoria-ai.github.io"];
const local = ["http://localhost:3000"];
// const current = server;

app.use(bodyParser.json());
const upload = multer();
// set no cors
app.use(
  cors({
    origin: server,

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
  // console.log(response.data.choices[0].message.content);
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
        timestamp: note.created_at // type timestampz
      };
    });
    return decryptedNotes;
  }
};

function combineNotes(notes) {
  let combinedString = "";
  for (let note of notes) {
    const dateOnlyString = new Date(note.timestamp).toISOString().slice(0, 10);
    combinedString += "<Date>:" + dateOnlyString + "\n<Note>:" + note.content + "\n\n";
  }
  return combinedString.trim();
}

// queryUserThoughts
app.post("/queryUserThoughts", async (req, res) => {
  console.log('starting queryUserThoughts')
  const userId = req.body.userId;
  const messages = req.body.messages;
  const notes = await fetchUserNotes(userId);
  const max_tokens = 200; 
  // const currentDate = new Date().toISOString().slice(0, 10); // this adds the date to the prompt as a reference
  const system_message = // maybe here we can specify all the different kinds of user cases and give examples
    "You will act as a bot that can help the user remember their thoughts, and expand/answer questions about them. \
    You will help the user remember thoughts by searching through your notes. \
    For example, you the user can ask 'search for my birthday', or 'what was the football idea I had'\
    When answering questions that consider a date, use the following date as today: "
    + '2023-05-17' + "\n\
    Here are the notes: " +
    combineNotes(notes);

  console.log("the messages are" + messages)
  console.log(req.body.messages)
  console.log(system_message)

  const processed_messages = [];
  for (let i = 0; i < messages.length; i++) {
    const role = messages[i].role
    const content = messages[i].text
    const dict = { role, content };
    processed_messages.push(dict);
  }

  const dict = {'role' : 'system', 'content' : system_message}
  processed_messages.unshift(dict);

  console.log(processed_messages)
  //console.log(req)
  console.log('Printing processed_messages')
  console.log(processed_messages);

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-3.5-turbo",
      messages: processed_messages,
      // messages: [{'role':'system','content': system_message},
      //            {'role':'user','content':'how many notes do I have?'}],
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
  //console.log("there");
  console.log(response.data.choices[0].message.content);
  return res.json(response.data.choices[0].message.content);
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
  // console.log('Tags updated successfully');
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

app.post("/fetchUserNotes", async (req, res) => {
  const userId = req.body.userId;
  const notes = await fetchUserNotes(userId);
  res.send(notes);
});

app.post("/getUserTags", async (req, res) => {
  const userId = req.body.userId;
  // console.log(userId);
  const tags = await getCurrentTags(userId);
  res.send(tags);
});

app.post("/deleteNote", async (req, res) => {
  const id = req.body.id;
  const data = await deleteNote(id);
  res.send(data);
});

app.post('/audio', upload.single('audio'), async (req, res) => {
  try {
    const audioBlob = req.file.buffer;
    const formData = new FormData();
    formData.append('model', 'whisper-1');
    formData.append('file', audioBlob, 'audio.wav');
    
    const whisperResponse = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.REACT_APP_GPT_PRIVATE_KEY}`,
          'Content-Type': 'multipart/form-data',
        },
      },
    );
  
    console.log(whisperResponse.data.text)
    const transcript = whisperResponse.data.text;
    res.setHeader('Content-Type', 'application/json');
    res.json({ text: transcript });
  } catch (error) {
    console.error('There was an error:', error);
    console.log(error.response.data)
    res.status(500).json({ message: 'Error processing audio' });
  }
});

app.listen(process.env.PORT || port, () => {
  console.log(`Server running`);
});
