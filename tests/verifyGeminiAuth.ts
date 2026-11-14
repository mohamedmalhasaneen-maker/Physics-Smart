import dotenv from 'dotenv';
import {
  getConfiguredGeminiKey,
  PRIMARY_GEMINI_MODEL,
  verifyGeminiAuthAndConnectivity,
} from '../server/geminiResilience.ts';

dotenv.config();

async function main() {
  const { envVarName } = getConfiguredGeminiKey();
  console.log('=== Physics Smart | Gemini Auth & Connectivity Check ===');
  console.log(`Primary Model : ${PRIMARY_GEMINI_MODEL}`);
  console.log(`Key Source    : ${envVarName || 'MISSING (GEMINI_API_KEY not set)'}`);

  const report = await verifyGeminiAuthAndConnectivity();
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        keyPresent: report.keyPresent,
        authenticated: report.authenticated,
        modelAvailable: report.modelAvailable,
        responseValid: report.responseValid,
        httpStatus: report.httpStatus,
        errorCode: report.errorCode,
        model: report.model,
        durationMs: report.durationMs,
        guidance: report.guidance,
      },
      null,
      2
    )
  );

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Auth verification script failed:', err?.message || err);
  process.exit(1);
});
