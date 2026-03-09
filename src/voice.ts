import { readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

export async function transcribeAudio(audioPath: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const audioBytes = readFileSync(audioPath);
  const base64Audio = audioBytes.toString("base64");

  const result = await model.generateContent([
    { text: "Transcribe this audio exactly. Return only the transcription text, nothing else." },
    {
      inlineData: {
        mimeType: "audio/wav",
        data: base64Audio,
      },
    },
  ]);

  return result.response.text().trim();
}

export function recordAudio(durationSeconds = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = join(tmpdir(), `voice-${Date.now()}.wav`);
    const isLinux = process.platform === "linux";
    const cmd = isLinux ? "arecord" : "rec";
    const args = isLinux
      ? ["-f", "S16_LE", "-r", "16000", "-c", "1", "-d", String(durationSeconds), outputPath]
      : ["-r", "16000", "-c", "1", "-b", "16", outputPath, "trim", "0", String(durationSeconds)];

    const proc = spawn(cmd, args, { stdio: "pipe" });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start audio recording. Install SoX: brew install sox\n${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`Audio recording exited with code ${code}.`));
    });
  });
}

export async function listenAndTranscribe(durationSeconds = 5): Promise<string> {
  console.log(`\nListening for ${durationSeconds} seconds...`);
  const audioPath = await recordAudio(durationSeconds);
  console.log("Transcribing...");
  const text = await transcribeAudio(audioPath);
  await unlink(audioPath).catch(() => {});
  return text;
}

export async function startVoiceLoop(
  onCommand: (transcript: string) => Promise<void>,
  options: { duration?: number; exitWord?: string } = {},
): Promise<void> {
  const duration = options.duration ?? 5;
  const exitWord = options.exitWord ?? "exit";

  console.log(`Voice mode active. Say "${exitWord}" to stop.`);
  console.log(`Listening in ${duration}-second intervals.\n`);

  while (true) {
    try {
      const transcript = await listenAndTranscribe(duration);
      console.log(`> Heard: "${transcript}"`);

      if (transcript.toLowerCase().includes(exitWord)) {
        console.log("Voice mode ended.");
        break;
      }

      await onCommand(transcript);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Voice error: ${msg}`);
    }
  }
}
