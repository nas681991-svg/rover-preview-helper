import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is missing.");
  console.error("Please set it by running: $env:ANTHROPIC_API_KEY='your_api_key' before running the script.");
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: apiKey,
});

async function main() {
  console.log("Connecting to Anthropic Fable 5...");
  
  try {
    const msg = await anthropic.messages.create({
      model: "claude-fable-5", // The API model ID for Anthropic's Fable 5
      max_tokens: 1024,
      messages: [
        { role: "user", content: "Hello! Please introduce yourself as Claude Fable 5 and give a short 1-sentence fun fact about fables." }
      ],
    });
    
    console.log("\nResponse from Fable:\n");
    console.log(msg.content[0].text);
    
  } catch (err) {
    console.error("\nError communicating with Anthropic API:");
    console.error(err.message);
  }
}

main();
