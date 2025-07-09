/*
 * qualityChecks.js – drop‑in Quality Gate for Trust‑or‑Doubt
 * -----------------------------------------------------------
 * 1. validateQuestions()   → synchroner Schema‑Check (Zod)
 * 2. scheduleDeepChecks()  → asynchroner Self‑Consistency + Cross‑Model Fact‑Check
 *    läuft im Hintergrund; flaggt fehlerhafte Fragen mit question.reported = true
 * 3. selfConsistentAnswer()/crossModelCheck() sind helfer‑funktionen; bei Fehlern wird
 *    nichts geblockt – nur geloggt & markiert, damit das Spiel sofort starten kann.
 *
 *  Installation:
 *  npm i zod
 *  ────────────────────────────────────────────────────────────
 *  In QuestionService.js (oder wo du Fragen einspeist):
 *    const { validateQuestions, scheduleDeepChecks } = require('./qualityChecks');
 *    ...
 *    questions = validateQuestions(questions);
 *    scheduleDeepChecks(questions);   // non‑blocking
 */

const z = require('zod');
const axios = require('axios');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────
// 1) Schema‑Check (synchron)
// ─────────────────────────────────────────────────────────────
const OptionSchema = z.string().min(1);
const QuestionSchema = z.object({
  id: z.string().uuid().optional(),
  question: z.string().min(8),
  options: z.array(OptionSchema).length(4)
           .refine((arr) => new Set(arr).size === 4, 'Options must be unique'),
  correct: z.number().int().min(0).max(3),
  category: z.string().min(2),
  difficulty: z.enum(['easy', 'medium', 'hard'])
});

function validateQuestions(rawQuestions = []) {
  const valid = [];
  for (const q of rawQuestions) {
    try {
      const parsed = QuestionSchema.parse(q);
      // Fallback‑ID, falls Generator keine gesetzt hat
      if (!parsed.id) parsed.id = crypto.randomUUID();
      valid.push(parsed);
    } catch (err) {
      console.warn('[QualityGate] Dropped invalid question:', err.issues?.[0]?.message || err.message);
    }
  }
  return valid;
}

// ─────────────────────────────────────────────────────────────
// 2) Asynchrone Deep‑Checks
// ─────────────────────────────────────────────────────────────
function scheduleDeepChecks(questions) {
  // Sofort asynchron auslagern, blockiert also NICHT den Request‑Flow
  setImmediate(() => runDeepChecks(questions));
}

async function runDeepChecks(questions) {
  for (const q of questions) {
    try {
      const okSelf   = await selfConsistentAnswer(q);
      const okCross  = await crossModelCheck(q);
      if (!okSelf || !okCross) {
        q.reported = true;  // Markieren, damit du sie später entfernst
        console.warn(`[QualityGate] Flagged Q “${q.question.slice(0,80)}…”`);
      }
    } catch (err) {
      console.error('[QualityGate] Deep check failed:', err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 2a) Self‑Consistency über Mehrheits‑Vote (3 Samples)
// ─────────────────────────────────────────────────────────────
async function selfConsistentAnswer(q, trials = 3) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return true; // Falls kein Key – Check überspringen

  const prompt = `Answer using only a single number (0‑3):\n${q.question}\n${q.options.map((o,i)=>`${i}) ${o}`).join('\n')}`;

  const votes = [];
  for (let i = 0; i < trials; i++) {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama3-8b-8192',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const choice = res.data.choices?.[0]?.message?.content?.trim();
    votes.push(choice);
  }
  const majority = votes.sort((a,b) => votes.filter(v=>v===a).length - votes.filter(v=>v===b).length).pop();
  return parseInt(majority, 10) === q.correct;
}

// ─────────────────────────────────────────────────────────────
// 2b) Cross‑Model‑Fact‑Check (billiges Modell oder Retrieval)
//     Hier ganz simpel via Wiki‑API; passe nach Wunsch an.
// ─────────────────────────────────────────────────────────────
async function crossModelCheck(q) {
  // Extrem simple Heuristik: capital‑Fragen, etc.
  if (/capital of|Hauptstadt|capital city/i.test(q.question)) {
    const match = q.question.match(/capital of ([A-Za-z ]+)/i);
    if (!match) return true;
    const country = match[1];
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(country)}`;
    try {
      const { data } = await axios.get(wikiUrl, { timeout: 4000 });
      const text = (data.extract || '').toLowerCase();
      return text.includes(q.options[q.correct].toLowerCase());
    } catch {
      return true; // Wenn Wiki down → nicht blockieren
    }
  }
  // Default: kein spezifischer Check → true
  return true;
}

module.exports = {
  validateQuestions,
  scheduleDeepChecks
};
