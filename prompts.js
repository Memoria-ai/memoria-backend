const axios = require("axios");
const chatGPT_model = "gpt-3.5-turbo-16k";

function configure_chatbot(notes) {
  let currentDate = new Date().toLocaleDateString(); // this adds the date to the prompt as a reference
  if (notes?.length == 0) {
    system_prompt =
      "You are an AI named Memoria that helps me reflect on my feelings, ideas, and thoughts, and to expand and answer questions about them. \
    Attempt to respond to my queries in a conversational, friendly and helpful manner and keep your responses very concise like a real conversation. Begin your response with something like: \
    'It's hard to respond accurately without you journalling, but...' then go on to respond.";
  } else {
    system_prompt =
      "You are an AI named Memoria that helps me reflect on my feelings, ideas, and thoughts using my journals entries, or expand and answer questions about them. \
    Attempt to respond to my queries based only on the content found in the text inside triple backticks,\
    unless I explicitly request you to be creative or to generate new ideas.\
    Respond in a conversational, friendly and helpful manner and keep your responses very concise like a real conversation.\
   Today's date is: " +
      currentDate +
      " and you should account for the dates of the journals when answering.\n" +
      "My journals and ideas:\n ```" +
      combineNotes(notes) +
      "```";
  }
  return system_prompt;
}

function combineNotes(notes) {
  let combinedString = "";
  if (notes.length > 0) {
    for (let note of notes) {
      const dateOnlyString = new Date(note?.timestamp).toLocaleDateString(); //toISOString().slice(0, 10); //toLocaleDateString() is better formatting IMO -mc
      combinedString +=
        "Journal Date: " +
        dateOnlyString +
        "\nJournal Content: " +
        note?.content +
        "\nJournal Tags: " +
        (note.tags ? note.tags.toString() : "") +
        "\n\n";
    }
  } else {
    combinedString = "No Notes Available";
  }
  return combinedString.trim();
}

async function identify_prompt_intent(user_prompt) {
  const possible_intents = ["summarize", "imagine", "self-reflection"];
  prompt =
    "Using 1 word, identify the intent of the query found inside triple backticks. \
    Attempt to match the intent to the closest option from the following list: " +
    possible_intents.join(", ") +
    "\n\
    If none of the options match, return the word 'other'.\
    Query:```" +
    user_prompt +
    "```";
  const messages = [{ role: "user", content: prompt }];
  response = await call_chatGPT(messages, 10, 0);
  // console.log("Identifying prompt intent for: " + user_prompt);
  // console.log("chatGTP response to prompt intent: " + response);
  return response;
}

async function resolve_prompt(intent, messages) {
  switch (intent) {
    // case "fact-recall":
    //   return await recall_fact_from_thoughts(messages);
    case "summarize":
      return await summarize_thoughts(messages);
    case "imagine":
      return await imagine(messages);
    case "self-reflection":
      return await reflect(messages);
    case "other":
      return await catch_all(messages);
    default:
      return await catch_all(messages);
  }
}

// this is a direct pure recall, that may be based on a date or period of time - we don't expect the model to be creative, just to reply
async function recall_fact_from_thoughts(messages) {
  // Harsh feedback: reference all thoughts or only 3? summarize the older ones? ask GTP for most relevant?
  // if no thoughts were related to query, reply X
  system_prompt =
    "You will first reply the prompt based on my journals, and then reference at most 3 of\
    the particular journals associated with the response that were provided earlier inside triple backticks. \
    The response should look like this:\n\
    Prompt response\n\
    Summary of all associated journals\n\n\
    Associated journals: n\
    [Date] Thought content\n\n\
    [Date] Thought content\n\n\
    [Date] Thought content\n\n\
    When providing dates in your response, provide them relative to the current date. For example: \
    If date is equal to the current date, use 'Today'.\
    If date is equal to the day previous to the current date, use 'Yesterday'.\
    If date falls in the week previous the current date, use 'Last Week'.\
    If fate falls in the month previous to the current date, use 'Last Month'.\
    For any other dates, you may use the format: Month-Day-Year.\
    DO NOT SAY 'Based on your journals' OR SIMILAR PHRASES";
  const dict = { role: "system", content: system_prompt };
  const temp = messages.pop();
  messages.push(dict);
  messages.push(temp);
  // console.log("Calling recall_fact_from_thoughts");
  response = await call_chatGPT(messages, 2000, 0);
  return response;
}

async function reflect(messages) {
  system_prompt =
    "Respond to my prompt using my journals as context. I want to understand \
    myself on a deeper level, and have my question answer. I want to continue \
    this conversation so create an opportunity for me to ask a follow up question.\
    Count the words in your response and keep response less than 300 words.\
    If you need more information to answer my question effectively, ask me.\
    DO NOT SAY 'Based on your journals' OR SIMILAR PHRASES";
  const dict = { role: "system", content: system_prompt };
  const temp = messages.pop();
  messages.push(dict);
  messages.push(temp);
  // console.log("Calling summarize_thoughts");
  response = await call_chatGPT(messages, 1500, 0);
  return response;
}

async function summarize_thoughts(messages) {
  system_prompt =
    "Summarize the journals that match my prompt. \
    Do not include Dates unless the prompt requests it.\
    DO NOT SAY 'Based on your journals' OR SIMILAR PHRASES";
  const dict = { role: "system", content: system_prompt };
  const temp = messages.pop();
  messages.push(dict);
  messages.push(temp);
  // console.log("Calling summarize_thoughts");
  response = await call_chatGPT(messages, 1500, 0);
  return response;
}

async function imagine(messages) {
  // Harsh: make explicit that there's information beyond what you've explicitly provided, and coming from external sources
  system_prompt =
    "You will review all journals related to my prompt, and brainstorm ideas that relate to these journals. Be creative, but make the brainstorm ideas feasible\
    DO NOT SAY 'Based on your journals' OR SIMILAR PHRASES";
  const dict = { role: "system", content: system_prompt };
  const temp = messages.pop();
  messages.push(dict);
  messages.push(temp);
  // console.log("Calling imagine");
  response = await call_chatGPT(messages, 2000, 0.8);
  return response;
}

// this is the catch all response to prompts, use high temp to make the model be creative
async function catch_all(messages) {
  // console.log("Calling catch_all");
  response = await call_chatGPT(messages, 1500, 0.2);
  return response;
}

//TODO add more use cases here

async function call_chatGPT(messages, max_tokens, temperature = 0) {
  // console.log("Calling chatGPT with the following prompt:");
  // console.log(messages);

  const response = await axios
    .post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: chatGPT_model,
        messages: messages,
        max_tokens: max_tokens,
        temperature: temperature,
        n: 1,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.REACT_APP_GPT_PRIVATE_KEY,
        },
      }
    )
    .catch((error) => {
      console.error("Error:", error.response.data.error);
    });
  if (
    response &&
    response.data &&
    response.data.choices &&
    response.data.choices.length > 0
  ) {
    return response.data.choices[0].message.content;
  }
  return "";
}

module.exports = {
  configure_chatbot,
  identify_prompt_intent,
  resolve_prompt,
  call_chatGPT,
};
