const { encryptData, decryptData, authenticateAndAuthorize, generateJwtToken } = require('./encryption');
const { supabase } = require("./supabaseClient");
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

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
      console.log('profileError')
      return 0;
    }
  
    const numQueries = profileData.num_queries;
    return numQueries;
  };
  
module.exports = {
    makeChatRequest,
    makeAudioTranscriptionRequest,
    fetchUserNotes,
    getCurrentTags,
    deleteNote,
    getDict,
    getAllTags,
    sendNewTags,
    updateTags,
    fetchNumQueries,
    };
