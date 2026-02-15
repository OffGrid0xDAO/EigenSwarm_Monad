import { getDb } from './db';

// ── Types ────────────────────────────────────────────────────────────────

export interface AIEvaluationRecord {
  id: number;
  eigen_id: string;
  proposed_type: string;
  proposed_reason: string;
  proposed_amount: string;
  ai_approved: number; // 0 or 1
  ai_confidence: number;
  ai_reason: string;
  ai_adjusted_amount: string | null;
  ai_suggested_wait: number | null;
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

// ── Schema Migration ─────────────────────────────────────────────────────

/**
 * Create the ai_evaluations table if it doesn't exist.
 * Safe to call multiple times.
 */
export function initAITables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eigen_id TEXT NOT NULL,
      proposed_type TEXT NOT NULL,
      proposed_reason TEXT NOT NULL,
      proposed_amount TEXT NOT NULL DEFAULT '0',
      ai_approved INTEGER NOT NULL DEFAULT 1,
      ai_confidence INTEGER NOT NULL DEFAULT 0,
      ai_reason TEXT NOT NULL DEFAULT '',
      ai_adjusted_amount TEXT,
      ai_suggested_wait INTEGER,
      model TEXT NOT NULL DEFAULT '',
      latency_ms INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ai_eval_eigen ON ai_evaluations(eigen_id);
    CREATE INDEX IF NOT EXISTS idx_ai_eval_created ON ai_evaluations(created_at);
  `);
}

// ── Logging Functions ────────────────────────────────────────────────────

export function logAIEvaluation(data: {
  eigenId: string;
  proposedType: string;
  proposedReason: string;
  proposedAmount: string;
  approved: boolean;
  confidence: number;
  reason: string;
  adjustedAmount?: string | null;
  suggestedWait?: number | null;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO ai_evaluations (
      eigen_id, proposed_type, proposed_reason, proposed_amount,
      ai_approved, ai_confidence, ai_reason, ai_adjusted_amount, ai_suggested_wait,
      model, latency_ms, input_tokens, output_tokens
    ) VALUES (
      @eigenId, @proposedType, @proposedReason, @proposedAmount,
      @approved, @confidence, @reason, @adjustedAmount, @suggestedWait,
      @model, @latencyMs, @inputTokens, @outputTokens
    )
  `).run({
    eigenId: data.eigenId,
    proposedType: data.proposedType,
    proposedReason: data.proposedReason,
    proposedAmount: data.proposedAmount,
    approved: data.approved ? 1 : 0,
    confidence: data.confidence,
    reason: data.reason,
    adjustedAmount: data.adjustedAmount ?? null,
    suggestedWait: data.suggestedWait ?? null,
    model: data.model,
    latencyMs: data.latencyMs,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
  });
}

export function getRecentAIEvaluations(eigenId: string, limit = 20): AIEvaluationRecord[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM ai_evaluations WHERE eigen_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(eigenId, limit) as AIEvaluationRecord[];
}

export function getAIEvaluationStats(eigenId: string): {
  total: number;
  approved: number;
  rejected: number;
  avgConfidence: number;
  avgLatencyMs: number;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN ai_approved = 1 THEN 1 ELSE 0 END), 0) as approved,
      COALESCE(SUM(CASE WHEN ai_approved = 0 THEN 1 ELSE 0 END), 0) as rejected,
      COALESCE(AVG(ai_confidence), 0) as avgConfidence,
      COALESCE(AVG(latency_ms), 0) as avgLatencyMs
    FROM ai_evaluations WHERE eigen_id = ?
  `).get(eigenId) as { total: number; approved: number; rejected: number; avgConfidence: number; avgLatencyMs: number };
  return row;
}
