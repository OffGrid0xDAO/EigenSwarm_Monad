import type { TradeDecision, EigenState } from './decision-engine';
import type { MarketContext } from './ai-context';
import { logAIEvaluation } from './ai-logger';
import { formatEther } from 'viem';

// ── Types ────────────────────────────────────────────────────────────────

export interface AIEvaluation {
  approved: boolean;
  confidence: number;        // 0-100
  adjustedAmount?: bigint;   // resized trade amount (wei for buys, raw for sells)
  reason: string;
  suggestedWait?: number;    // seconds to delay next trade
}

export interface AIConfig {
  enabled: boolean;
  provider: AIProvider;
  model: string;
  confidenceThreshold: number; // trades below this are rejected
  timeoutMs: number;
  apiKey: string;
  apiBaseUrl?: string;        // for Ollama or custom endpoints
}

export type AIProvider = 'gemini' | 'groq' | 'ollama' | 'anthropic' | 'openai-compatible';

// ── Fail-Open Default ────────────────────────────────────────────────────

const FAIL_OPEN: AIEvaluation = {
  approved: true,
  confidence: 75,
  reason: 'ai_unavailable: fail-open, executing rule engine decision',
};

// ── Provider-Agnostic Client ────────────────────────────────────────────

interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

interface LLMClient {
  chat(system: string, userMessage: string, maxTokens: number, timeoutMs: number): Promise<LLMResponse>;
}

let llmClient: LLMClient | null = null;

// ── Gemini Client (free tier: gemini-2.0-flash) ─────────────────────────

function createGeminiClient(apiKey: string): LLMClient {
  return {
    async chat(system, userMessage, maxTokens, timeoutMs) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ parts: [{ text: userMessage }] }],
              generationConfig: {
                maxOutputTokens: maxTokens,
                temperature: 0.2,
              },
            }),
            signal: controller.signal,
          },
        );

        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`Gemini API error ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const usage = data.usageMetadata || {};

        return {
          text,
          inputTokens: usage.promptTokenCount || 0,
          outputTokens: usage.candidatesTokenCount || 0,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

// ── Groq Client (free tier: llama-3.1-8b-instant) ──────────────────────

function createGroqClient(apiKey: string): LLMClient {
  return {
    async chat(system, userMessage, maxTokens, timeoutMs) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: currentModel,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userMessage },
            ],
            max_tokens: maxTokens,
            temperature: 0.2,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`Groq API error ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        const usage = data.usage || {};

        return {
          text,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

// ── Ollama Client (local, free) ─────────────────────────────────────────

function createOllamaClient(baseUrl: string): LLMClient {
  return {
    async chat(system, userMessage, maxTokens, timeoutMs) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: currentModel,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userMessage },
            ],
            stream: false,
            options: { num_predict: maxTokens, temperature: 0.2 },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`Ollama error ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();
        return {
          text: data.message?.content || '',
          inputTokens: data.prompt_eval_count || 0,
          outputTokens: data.eval_count || 0,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

// ── OpenAI-Compatible Client (generic: works with any OpenAI-compatible API) ──

function createOpenAICompatibleClient(apiKey: string, baseUrl: string): LLMClient {
  return {
    async chat(system, userMessage, maxTokens, timeoutMs) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: currentModel,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userMessage },
            ],
            max_tokens: maxTokens,
            temperature: 0.2,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`API error ${response.status}: ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        const usage = data.usage || {};

        return {
          text,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

// ── Client Initialization ────────────────────────────────────────────────

let currentModel = '';

const DEFAULT_MODELS: Record<AIProvider, string> = {
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.1-8b-instant',
  ollama: 'llama3.1',
  anthropic: 'claude-sonnet-4-20250514',
  'openai-compatible': 'gpt-4o-mini',
};

export function initAIClient(config: AIConfig): void {
  currentModel = config.model || DEFAULT_MODELS[config.provider];

  switch (config.provider) {
    case 'gemini':
      llmClient = createGeminiClient(config.apiKey);
      break;
    case 'groq':
      llmClient = createGroqClient(config.apiKey);
      break;
    case 'ollama':
      llmClient = createOllamaClient(config.apiBaseUrl || 'http://localhost:11434');
      break;
    case 'openai-compatible':
      llmClient = createOpenAICompatibleClient(config.apiKey, config.apiBaseUrl || 'https://api.openai.com/v1');
      break;
    case 'anthropic':
      // Use OpenAI-compatible endpoint for Anthropic (via their Messages API wrapper)
      llmClient = createOpenAICompatibleClient(config.apiKey, 'https://api.anthropic.com/v1');
      break;
  }

  console.log(`[AI] ${config.provider} client initialized (model: ${currentModel})`);
}

// ── Core Evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate a proposed trade using an LLM as a risk/strategy judge.
 *
 * Fail-open: if the API is down, times out, or returns garbage,
 * the original rule engine decision executes unchanged.
 */
export async function evaluateTrade(
  decision: TradeDecision,
  eigen: EigenState,
  position: { totalAmount: bigint; totalCost: number },
  currentPrice: number,
  context: MarketContext,
  config: AIConfig,
  customPrompt?: string | null,
): Promise<AIEvaluation> {
  if (!config.enabled || !llmClient) {
    return FAIL_OPEN;
  }

  const startTime = Date.now();
  const model = currentModel;

  try {
    const prompt = buildPrompt(decision, eigen, position, currentPrice, context);
    const systemPrompt = buildSystemPrompt(customPrompt);

    const response = await llmClient.chat(systemPrompt, prompt, 256, config.timeoutMs);

    const latencyMs = Date.now() - startTime;
    const { text: outputText, inputTokens, outputTokens } = response;

    // Parse the JSON response
    const evaluation = parseAIResponse(outputText, decision);

    // Apply confidence thresholds
    const finalEval = applyConfidenceRules(evaluation, config.confidenceThreshold, decision);

    // Log to SQLite
    const proposedAmount = decision.ethAmount
      ? formatEther(decision.ethAmount)
      : decision.tokenAmount
        ? (Number(decision.tokenAmount) * 1e-18).toFixed(6)
        : '0';

    logAIEvaluation({
      eigenId: eigen.eigenId,
      proposedType: decision.type,
      proposedReason: decision.reason,
      proposedAmount,
      approved: finalEval.approved,
      confidence: finalEval.confidence,
      reason: finalEval.reason,
      adjustedAmount: finalEval.adjustedAmount?.toString() ?? null,
      suggestedWait: finalEval.suggestedWait ?? null,
      model,
      latencyMs,
      inputTokens,
      outputTokens,
    });

    console.log(
      `[AI] ${eigen.eigenId}: ${finalEval.approved ? 'APPROVED' : 'REJECTED'} ` +
      `(confidence=${finalEval.confidence}, latency=${latencyMs}ms) — ${finalEval.reason}`,
    );

    return finalEval;
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errMsg = (error as Error).message;

    // Log the failure
    const proposedAmount = decision.ethAmount
      ? formatEther(decision.ethAmount)
      : decision.tokenAmount
        ? (Number(decision.tokenAmount) * 1e-18).toFixed(6)
        : '0';

    logAIEvaluation({
      eigenId: eigen.eigenId,
      proposedType: decision.type,
      proposedReason: decision.reason,
      proposedAmount,
      approved: true,
      confidence: 75,
      reason: `ai_error: ${errMsg.slice(0, 200)}`,
      model,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
    });

    console.warn(`[AI] ${eigen.eigenId}: evaluation failed (${latencyMs}ms), fail-open — ${errMsg.slice(0, 100)}`);
    return FAIL_OPEN;
  }
}

// ── Prompt Construction ──────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a trading risk evaluator for an autonomous market-making agent on Uniswap.

Your job is to evaluate a proposed trade and decide whether to approve, reject, or adjust it.

Rules:
- You MUST respond with ONLY valid JSON, no explanation text
- Keep the "reason" field under 100 characters
- adjustedAmount is a string representation of the amount (in ETH for buys, in token decimals for sells), or null to keep original
- suggestedWait is seconds to delay before the next trade, or null for default timing
- confidence is 0-100 where 100 = strongly approve

Response format:
{"approved": boolean, "confidence": number, "adjustedAmount": string | null, "reason": "brief explanation", "suggestedWait": number | null}`;

function buildSystemPrompt(customPrompt?: string | null): string {
  if (!customPrompt) return BASE_SYSTEM_PROMPT;
  return `${BASE_SYSTEM_PROMPT}\n\n## Custom Strategy Instructions\n${customPrompt}`;
}

function buildPrompt(
  decision: TradeDecision,
  eigen: EigenState,
  position: { totalAmount: bigint; totalCost: number },
  currentPrice: number,
  context: MarketContext,
): string {
  const tokensDecimal = Number(position.totalAmount) * 1e-18;
  const tokenValue = currentPrice > 0 ? tokensDecimal * currentPrice : 0;
  const totalValue = eigen.ethBalance + tokenValue;
  const tokenRatio = totalValue > 0 ? (tokenValue / totalValue) * 100 : 0;

  const entryPrice = position.totalCost > 0 && tokensDecimal > 0
    ? position.totalCost / tokensDecimal
    : 0;

  const unrealizedPnl = currentPrice > 0 && position.totalCost > 0
    ? ((tokenValue - position.totalCost) / position.totalCost) * 100
    : 0;
  const unrealizedPnlEth = tokenValue - position.totalCost;

  const actionStr = decision.ethAmount
    ? `BUY ${formatEther(decision.ethAmount)} ETH worth of ${eigen.config.token_symbol}`
    : `SELL ${(Number(decision.tokenAmount || 0n) * 1e-18).toFixed(6)} ${eigen.config.token_symbol}`;

  // Price history (compact)
  const priceHistory = context.recentPrices
    .map((p) => `${p.price.toFixed(10)} @ ${p.timestamp}`)
    .join('\n');

  // Recent trades (compact)
  const tradeHistory = context.recentTrades
    .map((t) => `${t.type} ${t.amount.toFixed(6)} ETH (pnl: ${t.pnl.toFixed(6)})`)
    .join('\n');

  return `PROPOSED TRADE:
- Action: ${actionStr}
- Type: ${decision.type}
- Reason: ${decision.reason}

CURRENT STATE:
- ETH Balance: ${eigen.ethBalance.toFixed(6)} ETH
- Token Balance: ${tokensDecimal.toFixed(6)} ${eigen.config.token_symbol}
- Token Ratio: ${tokenRatio.toFixed(1)}%
- Entry Price: ${entryPrice.toFixed(10)} ETH | Current Price: ${currentPrice.toFixed(10)} ETH
- Unrealized P&L: ${unrealizedPnl.toFixed(1)}% (${unrealizedPnlEth.toFixed(6)} ETH)
- Stop Loss: -${eigen.config.stop_loss}% | Profit Target: ${eigen.config.profit_target}%

RECENT PRICE HISTORY (5-min intervals):
${priceHistory || 'No data available'}

VOLATILITY: ${context.volatility.toFixed(1)}%

RECENT TRADES (last ${context.recentTrades.length}):
${tradeHistory || 'No recent trades'}

EXTERNAL ACTIVITY:
- Buy volume detected: ${context.externalBuyVolume.toFixed(6)} ETH

Evaluate this trade. Consider:
1. Is the sizing appropriate given current volatility?
2. Is the direction correct given price momentum?
3. Should we wait for better conditions?
4. Any risk factors (high volatility, low liquidity, recent losses)?`;
}

// ── Response Parsing ─────────────────────────────────────────────────────

function parseAIResponse(text: string, decision: TradeDecision): AIEvaluation {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[AI] No JSON found in response, fail-open');
      return FAIL_OPEN;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      approved?: boolean;
      confidence?: number;
      adjustedAmount?: string | null;
      reason?: string;
      suggestedWait?: number | null;
    };

    const evaluation: AIEvaluation = {
      approved: typeof parsed.approved === 'boolean' ? parsed.approved : true,
      confidence: typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
        : 75,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : 'no reason provided',
      suggestedWait: typeof parsed.suggestedWait === 'number' ? parsed.suggestedWait : undefined,
    };

    // Parse adjusted amount if provided
    if (parsed.adjustedAmount && typeof parsed.adjustedAmount === 'string') {
      try {
        const adjusted = parseFloat(parsed.adjustedAmount);
        if (adjusted > 0 && isFinite(adjusted)) {
          // Convert to bigint based on trade type
          if (decision.ethAmount) {
            evaluation.adjustedAmount = BigInt(Math.floor(adjusted * 1e18));
          } else if (decision.tokenAmount) {
            evaluation.adjustedAmount = BigInt(Math.floor(adjusted * 1e18));
          }
        }
      } catch {
        // Ignore invalid adjusted amounts
      }
    }

    return evaluation;
  } catch (error) {
    console.warn(`[AI] Failed to parse response: ${(error as Error).message}`);
    return FAIL_OPEN;
  }
}

// ── Confidence Rules ─────────────────────────────────────────────────────

/**
 * Apply confidence-based rules:
 * - confidence < 50 → reject
 * - confidence 50-threshold → reduce size by 50%
 * - confidence >= threshold → approve as-is or with AI adjustments
 */
function applyConfidenceRules(
  evaluation: AIEvaluation,
  threshold: number,
  decision: TradeDecision,
): AIEvaluation {
  if (evaluation.confidence < 50) {
    return {
      ...evaluation,
      approved: false,
      reason: `low_confidence (${evaluation.confidence}): ${evaluation.reason}`,
    };
  }

  if (evaluation.confidence < threshold && evaluation.confidence >= 50) {
    // Reduce trade size by 50%
    const halfAmount = decision.ethAmount
      ? decision.ethAmount / 2n
      : decision.tokenAmount
        ? decision.tokenAmount / 2n
        : undefined;

    return {
      ...evaluation,
      approved: true,
      adjustedAmount: halfAmount,
      reason: `reduced_size (confidence=${evaluation.confidence}<${threshold}): ${evaluation.reason}`,
    };
  }

  return evaluation;
}
