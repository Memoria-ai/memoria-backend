
const axios = require("axios");
const { Configuration, OpenAIApi } = require('openai')
const chatGPT_model = "gpt-3.5-turbo";


const configuration = new Configuration({ apiKey: process.env.REACT_APP_GPT_PRIVATE_KEY})
const openAi = new OpenAIApi(configuration)


async function getEmbeddings (input){
    console.log('getting embeddings')
    const embeddingResponse = await openAi.createEmbedding({
        model: 'text-embedding-ada-002',
        input,
    })
    const [{ embedding }] = embeddingResponse.data.data
    return embedding
}


module.exports = {
    getEmbeddings,
  };
 

