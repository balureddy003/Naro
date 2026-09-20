import type { Verification, VerifyInput, Verifier } from '@naro/core';
import { chat, type Model } from '@naro/model';

/**
 * LLM-as-judge: ask a model to score a result against a rubric.
 * Useful for open-ended outcomes no schema can express — but it is
 * another noisy model. Calibrate against human labels, and never make
 * it the sole gate for safety-critical claims.
 */
export class LlmJudgeVerifier implements Verifier {
  readonly id = 'llm-judge';
  private readonly model: Model;
  private readonly rubric: string;
  private readonly threshold: number;

  constructor(model: Model, rubric: string, threshold = 0.7) {
    this.model = model;
    this.rubric = rubric;
    this.threshold = threshold;
  }

  async verify(input: VerifyInput): Promise<Verification> {
    const res = await chat(this.model, {
      messages: [{
        role: 'user',
        content: [
          `Score this result 0.0-1.0 against the rubric. Reply with only the number.`,
          `Rubric: ${this.rubric}`,
          `Goal: ${input.goal.description}`,
          `Claimed result: ${JSON.stringify(input.result)}`,
        ].join('\n'),
      }],
      temperature: 0,
    });
    const raw = String(res.message.content).trim();
    const score = Number(raw);
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      return { ok: false, reason: `judge returned invalid score: ${raw.slice(0, 100)}` };
    }
    return score >= this.threshold
      ? { ok: true, evidence: { score, threshold: this.threshold } }
      : { ok: false, reason: `judge score ${score} < ${this.threshold}` };
  }
}
