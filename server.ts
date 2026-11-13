import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { evaluate } from 'mathjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '15mb' }));

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'physics-smart-api' });
});

// Deterministic Math Engine Endpoint (mathjs)
app.post('/api/math/verify', (req, res) => {
  try {
    const { expression, expected, tolerance = 0.02 } = req.body as {
      expression?: string;
      expected?: number;
      tolerance?: number;
    };
    if (!expression || typeof expression !== 'string') {
      res.status(400).json({ error: 'Expression is required.' });
      return;
    }
    const result = evaluate(expression);
    const numericResult = typeof result === 'number' ? result : Number(result);
    if (!Number.isFinite(numericResult)) {
      res.status(400).json({ error: 'Expression did not evaluate to a finite number.' });
      return;
    }
    const isMatch =
      typeof expected === 'number'
        ? Math.abs(numericResult - expected) <= Math.max(Math.abs(expected) * tolerance, 1e-6)
        : null;
    res.json({ result: numericResult, isMatch });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Math evaluation error' });
  }
});

// AI Physics Tutor Endpoint (3 Modes: tutor, analyzer, examiner)
app.post('/api/ai/tutor', async (req, res) => {
  try {
    const {
      message,
      mode = 'tutor',
      language = 'ar',
      level = 'intermediate',
      style = 'conceptual',
      detail = 'detailed',
      track = 'thanawiya',
      grade = '',
      lessonContext = '',
      history = [],
      attachment,
    } = req.body as {
      message: string;
      mode: 'tutor' | 'analyzer' | 'examiner';
      language: 'ar' | 'en' | 'bilingual';
      level: 'simple' | 'intermediate' | 'advanced';
      style: string;
      detail: 'concise' | 'detailed';
      track: string;
      grade: string;
      lessonContext?: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
      attachment?: { mimeType: string; data: string };
    };

    if (!message && !attachment) {
      res.status(400).json({ error: 'Message or attachment is required.' });
      return;
    }

    const ai = getGeminiClient();

    const trackLabel =
      track === 'thanawiya'
        ? 'الثانوية العامة المصرية (Egyptian Thanawiya Amma)'
        : track === 'baccalaureate'
        ? 'البكالوريا المصرية (Egyptian Baccalaureate)'
        : 'American Diploma Physics (High School / Honors / AP Physics — Bilingual Arabic & English Support)';

    const modeInstructions =
      mode === 'tutor'
        ? `You are in TUTOR MODE (وضع المدرس). Explain physics concepts from first principles using clear analogies, step-by-step derivations, symbol & unit definitions, and check the student's understanding with a gentle follow-up check.`
        : mode === 'analyzer'
        ? `You are in ANALYZER MODE (وضع المحلل). Dissect the problem or diagram rigorously: list Givens with units, Target, SI unit conversions, Formula selection rationale, Algebraic substitution, Numerical evaluation, and Physical sanity check.`
        : `You are in EXAMINER MODE (وضع الممتحن). Ask ONE challenging conceptual or numerical question appropriate to the student's track and wait for their attempt. NEVER reveal the final answer before the student attempts! If the message contains the student's attempt, grade it carefully, point out exact errors or unit mistakes, explain why, and then give the next question or follow-up.`;

    const languageInstruction =
      language === 'bilingual'
        ? `BILINGUAL (Arabic + English): Respond clearly in BOTH Arabic and English! Provide:
  (1) A complete, natural scientific Arabic explanation (العربية الفصحى العلمية) with key English physics terms in parentheses.
  (2) Directly below or paired cleanly, an English Explanation section ("**English Explanation:**") covering the same reasoning and terminology in crisp academic English.
  You MUST understand student inputs written in Arabic, English, or mixed Arabic-English (and images in either language).`
        : language === 'ar'
        ? 'Arabic (العربية الفصحى العلمية الواضحة مع المصطلحات الإنجليزية الفيزيائية بين قوسين). Understand questions written in Arabic, English, or mixed Arabic-English.'
        : 'English (clear academic English; understand questions written in Arabic, English, or mixed Arabic-English).';

    const systemInstruction = `You are Physics Smart AI Tutor (مدرس الفيزياء الذكي).
Student Track: ${trackLabel} | Grade: ${grade || 'General'}.
Response Language: ${languageInstruction}.
Explanation Level: ${level}. Style: ${style}. Depth: ${detail}.
${modeInstructions}

SCIENTIFIC ACCURACY RULES (MANDATORY):
1. Verify all laws, equations, constants, and SI units explicitly.
2. Clearly state physical assumptions (e.g., negligible air resistance, ideal wire, g = 9.8 m/s² or 10 m/s²).
3. Distinguish exact analytical expressions from rounded decimal approximations.
4. NEVER fabricate official ministry curriculum claims. If grounded context is provided below, align strictly with it.
5. If the student's question or image is ambiguous or missing values, ask for clarification instead of guessing.
6. Format all equations in clean LaTeX wrapped in $$...$$ for display blocks or $...$ for inline formulas.
${lessonContext ? `\nAPPROVED PLATFORM LESSON CONTEXT:\n${lessonContext.slice(0, 6000)}` : ''}`;

    const parts: any[] = [];
    if (attachment?.data && attachment?.mimeType) {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data,
        },
      });
    }
    if (message) {
      parts.push({ text: message });
    }

    const formattedHistory = (history || []).slice(-10).map((h) => ({
      role: h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.text }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [...formattedHistory, { role: 'user', parts }],
      config: {
        systemInstruction,
        thinkingConfig: {
          thinkingLevel: detail === 'detailed' ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
        },
      },
    });

    res.json({ reply: response.text || '' });
  } catch (err: any) {
    console.error('AI Tutor Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate AI tutor response.' });
  }
});

// Smart Physics Solver (11-step structured analysis + mathjs verification)
app.post('/api/ai/solver', async (req, res) => {
  try {
    const {
      problemText = '',
      manualGivens = [],
      manualTarget = '',
      language = 'ar',
      track = 'thanawiya',
      attachment,
    } = req.body as {
      problemText?: string;
      manualGivens?: Array<{ symbol: string; value: string; unit: string }>;
      manualTarget?: string;
      language?: 'ar' | 'en' | 'bilingual';
      track?: string;
      attachment?: { mimeType: string; data: string };
    };

    if (!problemText.trim() && manualGivens.length === 0 && !attachment) {
      res.status(400).json({ error: 'Please provide a problem statement, manual givens, or an image/PDF.' });
      return;
    }

    const ai = getGeminiClient();

    const givensSummary =
      manualGivens.length > 0
        ? `\nManual Givens:\n${manualGivens.map((g) => `- ${g.symbol} = ${g.value} ${g.unit}`).join('\n')}\nTarget: ${manualTarget}`
        : '';

    const solverLangDesc =
      language === 'bilingual'
        ? 'BOTH Arabic and English (Bilingual mode): for every narrative field (clarificationQuestion, understanding, target, unitConversions, formulaReason, calculations, finalAnswerText, sanityCheck, and givens[].meaning), write a clear scientific Arabic line first followed by a newline and the matching English translation/terminology on the next line, while keeping selectedFormulaLatex and substitutionLatex pure LaTeX and verificationExpression pure mathjs arithmetic'
        : language === 'ar'
        ? 'Arabic (with standard English physics symbols/LaTeX and SI units)'
        : 'English';

    const prompt = `Analyze and solve the following physics problem (which may be written in Arabic, English, or mixed text/image) for the ${track} curriculum in ${solverLangDesc}.
If the problem is unclear or missing critical numerical data, set needsClarification=true and explain what is missing in clarificationQuestion.
Otherwise, provide all 11 pedagogical steps accurately, plus a pure numeric mathjs-compatible arithmetic expression in "verificationExpression" (using only numbers, +, -, *, /, ^, sqrt, sin, cos, tan, pi) so our deterministic math engine can verify the final scalar result!

Problem:
${problemText}
${givensSummary}`;

    const parts: any[] = [];
    if (attachment?.data && attachment?.mimeType) {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data,
        },
      });
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        systemInstruction:
          'You are an exact Physics Problem Solver. Verify every unit conversion, state assumptions (like g=9.8 m/s^2), use standard LaTeX for formulas, and ensure arithmetic in verificationExpression matches the final numerical answer.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            needsClarification: { type: Type.BOOLEAN },
            clarificationQuestion: { type: Type.STRING },
            understanding: { type: Type.STRING, description: 'Step 1: Understanding the physical scenario and assumptions' },
            givens: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: { type: Type.STRING },
                  value: { type: Type.STRING },
                  unit: { type: Type.STRING },
                  meaning: { type: Type.STRING },
                },
              },
              description: 'Step 2: Extracted givens',
            },
            target: { type: Type.STRING, description: 'Step 3: Required quantity and symbol' },
            unitConversions: { type: Type.STRING, description: 'Step 4: SI unit conversions performed' },
            selectedFormulaLatex: { type: Type.STRING, description: 'Step 5: Main formula in pure LaTeX without $$' },
            formulaReason: { type: Type.STRING, description: 'Step 6: Why this law/formula applies here' },
            substitutionLatex: { type: Type.STRING, description: 'Step 7: Substitution step in pure LaTeX' },
            calculations: { type: Type.STRING, description: 'Step 8: Detailed arithmetic breakdown' },
            verificationExpression: {
              type: Type.STRING,
              description: 'Pure mathjs arithmetic expression (e.g. "0.5 * 9.8 * 4^2") evaluating to the final scalar value, or empty string if symbolic',
            },
            finalNumericValue: { type: Type.NUMBER, description: 'Final numeric scalar value if applicable' },
            finalAnswerText: { type: Type.STRING, description: 'Step 9: Final answer clearly stated (exact & rounded)' },
            unit: { type: Type.STRING, description: 'Step 10: Final SI unit' },
            sanityCheck: { type: Type.STRING, description: 'Step 11: Dimensional and physical reasonableness check' },
          },
          required: [
            'needsClarification',
            'understanding',
            'givens',
            'target',
            'unitConversions',
            'selectedFormulaLatex',
            'formulaReason',
            'substitutionLatex',
            'calculations',
            'finalAnswerText',
            'unit',
            'sanityCheck',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');

    // Deterministic Math.js verification
    let mathVerification: { verified: boolean; engineValue?: number; expression?: string; note?: string } = {
      verified: false,
    };

    if (parsed.verificationExpression && typeof parsed.verificationExpression === 'string') {
      try {
        const evalResult = evaluate(parsed.verificationExpression);
        const engineNum = typeof evalResult === 'number' ? evalResult : Number(evalResult);
        if (Number.isFinite(engineNum)) {
          const matches =
            typeof parsed.finalNumericValue === 'number'
              ? Math.abs(engineNum - parsed.finalNumericValue) <= Math.max(Math.abs(engineNum) * 0.02, 1e-4)
              : true;
          mathVerification = {
            verified: matches,
            engineValue: Number(engineNum.toPrecision(6)),
            expression: parsed.verificationExpression,
            note: matches ? 'Verified by Math.js engine' : 'Engine recalculated exact value',
          };
        }
      } catch {
        mathVerification = { verified: false, note: 'Symbolic or non-scalar expression' };
      }
    }

    res.json({ solution: parsed, mathVerification });
  } catch (err: any) {
    console.error('Solver Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to solve physics problem.' });
  }
});

// Explain a specific step in the solver
app.post('/api/ai/solver/explain-step', async (req, res) => {
  try {
    const { stepTitle, stepContent, problemContext, language = 'ar' } = req.body as {
      stepTitle: string;
      stepContent: string;
      problemContext: string;
      language?: 'ar' | 'en' | 'bilingual';
    };
    const ai = getGeminiClient();
    const stepLangPrompt =
      language === 'bilingual'
        ? 'Bilingual (Arabic explanation first, followed by a clear English explanation section)'
        : language === 'ar'
        ? 'Arabic (with English physics terms in parentheses)'
        : 'English';
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Explain this specific physics solution step clearly for a student who wants deeper understanding.
Language: ${stepLangPrompt}
Step: ${stepTitle}
Step Content: ${stepContent}
Original Problem Context: ${problemContext}
Use clean LaTeX ($...$ or $$...$$) and verify all units.`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    res.json({ explanation: response.text || '' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to explain step.' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Physics Smart server listening on http://localhost:${PORT}`);
  });
}

startServer();
