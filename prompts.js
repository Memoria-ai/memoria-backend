const axios = require("axios");
const chatGPT_model = "gpt-3.5-turbo";

function configure_chatbot(notes) {
    let currentDate = new Date().toISOString().slice(0, 10); // this adds the date to the prompt as a reference
    system_prompt = "You will act as a bot named Memoria that helps me remember my thoughts and ideas, and expand and answer questions about them. \
    Attempt to respond to my queries based exclusively on the thoughts and ideas found in the text inside triple backticks,\
    unless I explicitly request you to be creative or to generate new ideas. \
    When answering questions that consider a date, use the following as the current date: " + currentDate + ".\n" +
    "User thoughts: ```" + combineNotes(notes) + "```";
    return system_prompt
}

function combineNotes(notes) {
    let combinedString = "";
    for (let note of notes) {
      const dateOnlyString = new Date(note.timestamp).toISOString().slice(0, 10);
      combinedString +=
        "Date: " +
        dateOnlyString +
        "\nNote: " +
        note.content +
        "\nTags: " +
        note.tags.toString() +
        "\n\n";
    }
    return combinedString.trim();
  }

async function identify_prompt_intent(user_prompt) {
    const possible_intents = ["recall","summarize","imagine"]
    prompt = "Using 1 word, identify the intent of the query found inside triple backticks. \
    Attempt to match the intent to the closest option from the following list: " + possible_intents.join(" ") + "\n\
    If none of the options match, return the word 'other'.\
    Query:```" + user_prompt + "```"
    const messages = [{role:'user', content: prompt}]
    response = await call_chatGPT(messages, 10, 0)
    console.log("Identifying prompt intent for: " + user_prompt)
    console.log("chatGTP response to prompt intent: "+ response);
    return response
}

function resolve_prompt(intent, messages) {
    switch(intent) {
        case "recall":
            return recall_fact_from_thoughts(messages)
        case "summarize":
            return summarize_thoughts(messages)
        case "imagine":
            return imagine(messages)  
        case "other":
            return catch_all(messages)
        default:
            return catch_all(messages)
    }
}

// this is a direct pure recall, that may be based on a date or period of time - we don't expect the model to be creative, just to reply
async function recall_fact_from_thoughts(messages) {
    system_prompt = "You will reply to my prompt by recalling from my thoughts provided earlier inside triple backticks. \
    If only one thought matches my prompt, you will reply based on the Note: content of the thought.\
    If multiple thoughts match my prompt, you will first summarize the Note: contents of all matching notes, and then append the following:\
    Date: date_here | Note: note_content\n\
    Date: date_here | Note: note_content\n\
    ...\
    Date: date_here | Note: note_content\n\
    When providing dates, you will convert them based on these rules: \
    If date is equal to the current date, use 'Today'.\
    If date is equal to the day previous to the current date, use 'Yesterday'.\
    If date falls in the week previous the current date, use 'Last Week'.\
    If fate falls in the month previous to the current date, use 'Last Month'.\
    For any other dates, you may use the format: Month-Day-Year";
    const dict = {role: "system", content: system_prompt}
    let full_messages = messages.splice(messages.length - 1, 0, dict) // this adds a message that talks to the ear of chatGPT without the user knowing, right before their last prompt
    console.log("Calling recall_fact_from_thoughts");
    response = await call_chatGPT(full_messages, 2000, 0);
    return response
}

async function summarize_thoughts(messages) {
    system_prompt = "You will summarize the thoughts that match my prompt. Only inlude the Note: content of the thoughts, \
    and do not include the Dates unless the prompt specifies this explictly";
    const dict = {role: "system", content: system_prompt}
    let full_messages = messages.splice(messages.length - 1, 0, dict) // this adds a message that talks to the ear of chatGPT without the user knowing, right before their last prompt
    console.log("Calling summarize_thoughts");
    response = await call_chatGPT(full_messages, 2000, 0);
    return response
}

async function imagine(messages) {
    system_prompt = "You will review all thoughts related to my prompt, and brainstorm ideas that relate to these thoughts. Be creative, but make the brainstorm ideas feasible";
    const dict = {role: "system", content: system_prompt}
    let full_messages = messages.splice(messages.length - 1, 0, dict) // this adds a message that talks to the ear of chatGPT without the user knowing, right before their last prompt
    console.log("Calling imagine");
    response = await call_chatGPT(full_messages, 2000, 0.8);
    return response
}

// this is the catch all response to prompts, use high temp to make the model be creative
async function catch_all(messages) {
    console.log("Calling catch_all");
    response = await call_chatGPT(messages, 2000, 0.2);
    return response
}

//TODO add more use cases here

async function call_chatGPT(messages, max_tokens, temperature=0) {
    const response = await axios.post(
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
      );
    return response.data.choices[0].message.content
}

module.exports = {
    configure_chatbot,
    identify_prompt_intent,
    resolve_prompt,
    call_chatGPT
};