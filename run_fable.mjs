/**
 * run_fable.mjs
 * 
 * A highly robust, fault-tolerant execution script for Anthropic's Claude Fable 5.
 * Implements SOTA engineering practices including rigid validation, graceful degradation,
 * and comprehensive error handling.
 * 
 * UPDATE: Supports alternative endpoints (e.g. OpenRouter or custom proxies) to bypass
 * primary provider lock-in or outages.
 */

import Anthropic from '@anthropic-ai/sdk';

// 1. Process-level safety and graceful degradation
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL ERROR] Unhandled Promise Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL ERROR] Uncaught Exception:', error);
  process.exit(1);
});

// 2. Multi-Provider & Alternative Key Resolution
// We check for primary Anthropic key or fallback to OpenRouter or an Alternative Key
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const alternativeKey = process.env.OPENROUTER_API_KEY || process.env.ALTERNATIVE_API_KEY;

let activeKey = anthropicKey;
let activeBaseUrl = undefined; // Undefined defaults to Anthropic's official API

if (!anthropicKey) {
  if (alternativeKey) {
    console.log('[INFO] Anthropic API key not found. Engaging ALTERNATIVE provider routing (e.g., OpenRouter).');
    activeKey = alternativeKey;
    // Route to OpenRouter API (or other SOTA alternative endpoint) if alternative key is provided
    activeBaseUrl = process.env.ALTERNATIVE_BASE_URL || 'https://openrouter.ai/api/v1';
  } else {
    console.error('[VALIDATION ERROR] No valid API key found for Claude Fable 5.');
    console.error('Please set either: $env:ANTHROPIC_API_KEY, $env:OPENROUTER_API_KEY, or $env:ALTERNATIVE_API_KEY');
    process.exit(1);
  }
} else if (!anthropicKey.startsWith('sk-ant-')) {
  console.warn('[WARNING] ANTHROPIC_API_KEY does not start with "sk-ant-". Proceeding anyway, but ensure this is a valid key.');
}

// 3. Bulletproof Client Initialization
const anthropic = new Anthropic({
  apiKey: activeKey,
  baseURL: activeBaseUrl, // Only set if using alternative provider
  maxRetries: 5,          // Aggressive exponential backoff via SDK
  timeout: 60 * 1000,     // Strict 60-second timeout circuit breaker
});

/**
 * Executes a request to Claude Fable 5 with exhaustive error handling.
 */
async function main() {
  console.log(`[INFO] Initializing connection to ${activeBaseUrl ? 'Alternative API' : 'Anthropic API'} (Model: claude-fable-5)...`);
  
  try {
    const response = await anthropic.messages.create({
      // Depending on the alternative provider, the model string might need mapping
      // OpenRouter usually uses "anthropic/claude-fable-5" or similar format.
      model: activeBaseUrl ? 'anthropic/claude-fable-5' : 'claude-fable-5',
      max_tokens: 1024,
      messages: [
        { 
          role: 'user', 
          content: 'Hello! Please introduce yourself as Claude Fable 5 and give a short 1-sentence fun fact about fables.' 
        }
      ],
    });
    
    // 4. Exhaustive Output Validation
    if (!response || !Array.isArray(response.content) || response.content.length === 0) {
      throw new Error('API returned an empty or malformed content array.');
    }
    
    const textBlock = response.content.find(block => block.type === 'text');
    
    if (!textBlock || !textBlock.text) {
      throw new Error('API returned successfully but no text block was found in the response.');
    }

    console.log('\n[SUCCESS] Response received:\n');
    console.log(textBlock.text);
    
  } catch (err) {
    // 5. Explicit error classification and logging
    console.error('\n[ERROR] Failed to communicate with API.');
    
    if (err instanceof Anthropic.APIError) {
      console.error(`[API Error] Status: ${err.status}`);
      console.error(`[API Error] Message: ${err.message}`);
      console.error(`[API Error] Type: ${err.type}`);
    } else {
      console.error(`[System Error] ${err.message}`);
    }
    
    process.exit(1);
  }
}

// 6. Execute and catch top-level synchronicity errors
main().catch(err => {
  console.error('[FATAL ERROR] Unexpected synchronous failure in main execution block:', err);
  process.exit(1);
});
